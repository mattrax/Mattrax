import { createHash } from "node:crypto";
import path from "node:path";
import { DateTime, Effect, FileSystem, Option, PlatformError, Schema } from "effect";
import type {
  R2Bucket,
  R2GetOptions,
  R2ListOptions,
  R2Object,
  R2ObjectBody,
  R2Objects,
  R2PutValue,
} from "@mattrax/enterprise-core";

/**
 * Filesystem implementation of the R2 binding for the Node runtime.
 *
 * Keys are base64url encoded so a tenant-controlled key can never traverse the
 * storage root. Object bodies and metadata live in separate directories; the
 * metadata file is written last so a crash leaves an orphan body (harmless)
 * rather than a listed object with no bytes.
 */

const StoredObject = Schema.Struct({
  key: Schema.String,
  size: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  etag: Schema.String,
  uploaded: Schema.String.check(
    Schema.makeFilter<string>((value) => {
      const decoded = Option.getOrUndefined(
        Schema.decodeUnknownOption(Schema.DateTimeUtcFromString)(value),
      );

      return decoded && DateTime.toDateUtc(decoded).toISOString() === value
        ? true
        : "a valid UTC timestamp";
    }),
  ),
  httpMetadata: Schema.optional(
    Schema.Struct({
      contentType: Schema.optional(Schema.String),
      contentLanguage: Schema.optional(Schema.String),
      cacheControl: Schema.optional(Schema.String),
      contentDisposition: Schema.optional(Schema.String),
      contentEncoding: Schema.optional(Schema.String),
    }),
  ),
  customMetadata: Schema.optional(Schema.Record(Schema.String, Schema.String)),
});

type StoredObject = Schema.Schema.Type<typeof StoredObject>;

const encodeKey = (key: string) => Buffer.from(key, "utf8").toString("base64url");

const toBytes = async (value: R2PutValue): Promise<Uint8Array> => {
  if (value === null) return new Uint8Array();

  if (Schema.is(Schema.String)(value)) return new TextEncoder().encode(value);

  if (value instanceof Blob) return new Uint8Array(await value.arrayBuffer());

  if (value instanceof ArrayBuffer) return new Uint8Array(value);

  if (ArrayBuffer.isView(value))
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);

  return new Uint8Array(await new Response(value).arrayBuffer());
};

const toObject = (stored: StoredObject): R2Object => ({
  key: stored.key,
  version: stored.etag,
  size: stored.size,
  etag: stored.etag,
  httpEtag: `"${stored.etag}"`,
  uploaded: new Date(stored.uploaded),
  httpMetadata: stored.httpMetadata,
  customMetadata: stored.customMetadata,
});

const toBody = (stored: StoredObject, bytes: Uint8Array): R2ObjectBody => {
  let used = false;

  const consume = () => {
    if (used) throw new TypeError("Body has already been used");

    used = true;

    return bytes;
  };

  return {
    ...toObject(stored),
    // Copy the view so a later mutation of the shared buffer cannot change a
    // response that has already been handed to a caller.
    body: new Response(new Uint8Array(bytes)).body!,
    get bodyUsed() {
      return used;
    },
    arrayBuffer: async () => consume().slice().buffer,
    text: async () => new TextDecoder().decode(consume()),
    // SAFETY: the caller chooses `T` for its own stored JSON; this mirrors R2's
    // untyped `json<T>()` contract.
    json: async <T = unknown>() => JSON.parse(new TextDecoder().decode(consume())) as T,
    blob: async () => new Blob([consume().slice()]),
  };
};

/** The subset of R2's range form this local bucket implements. */
const R2Range = Schema.Struct({
  offset: Schema.optional(Schema.Number),
  length: Schema.optional(Schema.Number),
  suffix: Schema.optional(Schema.Number),
});

const rangeOf = (bytes: Uint8Array, range: R2GetOptions["range"]): Uint8Array => {
  if (range === undefined || range === null) return bytes;

  const value = Option.getOrNull(Schema.decodeUnknownOption(R2Range)(range));

  if (value === null) return bytes;

  if (value.suffix !== undefined) return bytes.subarray(Math.max(0, bytes.length - value.suffix));

  const offset = Math.max(0, value.offset ?? 0);

  if (offset >= bytes.length) return new Uint8Array();

  const end =
    value.length !== undefined ? Math.min(bytes.length, offset + value.length) : bytes.length;

  return bytes.subarray(offset, end);
};

const isNotFound = (error: PlatformError.PlatformError): boolean =>
  PlatformError.isPlatformError(error) && error.reason._tag === "NotFound";

export type FileSystemR2Options = {
  readonly root: string;
};

/**
 * Build a bucket backed by `root` using Effect's FileSystem service. The Node
 * entry supplies NodeFileSystem; tests can supply an in-memory or failing
 * filesystem without changing the adapter.
 */
export const fileSystemR2 = ({ root }: FileSystemR2Options) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const bodies = path.join(root, "objects");
    const metas = path.join(root, "meta");

    const bodyPath = (key: string) => path.join(bodies, `${encodeKey(key)}.bin`);
    const metaPath = (key: string) => path.join(metas, `${encodeKey(key)}.json`);
    const run = <A>(effect: Effect.Effect<A, unknown, never>) => Effect.runPromise(effect);

    const readMeta = (key: string) =>
      fs.readFileString(metaPath(key)).pipe(
        Effect.catchIf(isNotFound, () => Effect.succeed(null)),
        Effect.flatMap((text) =>
          text === null
            ? Effect.succeed(null)
            : Schema.decodeUnknownEffect(StoredObject)(JSON.parse(text)),
        ),
      );

    const writeAtomic = (target: string, data: string | Uint8Array) =>
      Effect.scoped(
        Effect.gen(function* () {
          const temporary = yield* fs.makeTempFileScoped({ directory: path.dirname(target) });
          const write =
            typeof data === "string"
              ? fs.writeFileString(temporary, data, { mode: 0o600 })
              : fs.writeFile(temporary, data, { mode: 0o600 });

          yield* write;
          yield* fs.rename(temporary, target);
        }),
      );

    const bucket: R2Bucket = {
      head: (key) =>
        run(readMeta(key).pipe(Effect.map((stored) => (stored ? toObject(stored) : null)))),

      get: (key, options) =>
        run(
          readMeta(key).pipe(
            Effect.flatMap((stored) => {
              if (!stored) return Effect.succeed(null);

              return fs.readFile(bodyPath(key)).pipe(
                Effect.catchIf(isNotFound, () => Effect.succeed(null)),
                Effect.map((bytes) =>
                  bytes === null ? null : toBody(stored, rangeOf(bytes, options?.range)),
                ),
              );
            }),
          ),
        ),

      put: async (key, value, options) => {
        const bytes = await toBytes(value);
        const etag = createHash("md5").update(bytes).digest("hex");
        const stored: StoredObject = {
          key,
          size: bytes.byteLength,
          etag,
          uploaded: new Date().toISOString(),
          httpMetadata: options?.httpMetadata,
          customMetadata: options?.customMetadata,
        };

        await run(
          Effect.gen(function* () {
            yield* fs.makeDirectory(bodies, { recursive: true, mode: 0o700 });
            yield* fs.makeDirectory(metas, { recursive: true, mode: 0o700 });
            yield* writeAtomic(bodyPath(key), bytes);
            yield* writeAtomic(metaPath(key), JSON.stringify(stored));
          }),
        );

        return toObject(stored);
      },

      delete: (keys) => {
        const list = Schema.is(Schema.String)(keys) ? [keys] : keys;

        return run(
          Effect.forEach(
            list.flatMap((key) => [bodyPath(key), metaPath(key)]),
            (target) => fs.remove(target, { force: true }),
            { concurrency: 8, discard: true },
          ),
        );
      },

      list: (options?: R2ListOptions) =>
        run(
          Effect.gen(function* () {
            const prefix = options?.prefix ?? "";
            const limit = Math.max(1, Math.min(options?.limit ?? 1000, 1000));
            const names = yield* fs
              .readDirectory(metas)
              .pipe(Effect.catchIf(isNotFound, () => Effect.succeed([])));
            const stored = yield* Effect.forEach(
              names.filter((name) => name.endsWith(".json")),
              (name) =>
                fs
                  .readFileString(path.join(metas, name))
                  .pipe(
                    Effect.flatMap((text) =>
                      Schema.decodeUnknownEffect(StoredObject)(JSON.parse(text)),
                    ),
                  ),
              { concurrency: 8 },
            );

            const matching = stored
              .filter((item) => item.key.startsWith(prefix))
              .sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0));
            const cursor = options?.cursor
              ? Buffer.from(options.cursor, "base64url").toString("utf8")
              : undefined;
            const start = cursor ? matching.findIndex((item) => item.key > cursor) : 0;
            const slice = start < 0 ? [] : matching.slice(start, start + limit + 1);
            const truncated = slice.length > limit;
            const page = truncated ? slice.slice(0, limit) : slice;
            const delimitedPrefixes = new Set<string>();

            if (options?.delimiter)
              for (const item of page) {
                const rest = item.key.slice(prefix.length);
                const index = rest.indexOf(options.delimiter);

                if (index >= 0)
                  delimitedPrefixes.add(prefix + rest.slice(0, index + options.delimiter.length));
              }

            return {
              objects: page.map(toObject),
              truncated,
              cursor: truncated
                ? Buffer.from(page.at(-1)!.key, "utf8").toString("base64url")
                : undefined,
              delimitedPrefixes: [...delimitedPrefixes],
            } satisfies R2Objects;
          }),
        ),
    };

    return bucket;
  });
