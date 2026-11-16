import { createHash, randomUUID } from "node:crypto";
import { Option, Schema } from "effect";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  R2Bucket,
  R2GetOptions,
  R2ListOptions,
  R2Object,
  R2ObjectBody,
  R2Objects,
  R2PutOptions,
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

type StoredObject = {
  readonly key: string;
  readonly size: number;
  readonly etag: string;
  readonly uploaded: string;
  readonly httpMetadata?: R2PutOptions["httpMetadata"];
  readonly customMetadata?: Record<string, string>;
};

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

export type FileSystemR2Options = {
  readonly root: string;
};

/**
 * Build a bucket backed by `root`. `bodyPath` and `metaPath` are derived from
 * the encoded key so listing never has to trust the key for filesystem access.
 */
export const fileSystemR2 = ({ root }: FileSystemR2Options): R2Bucket => {
  const bodies = path.join(root, "objects");
  const metas = path.join(root, "meta");

  const bodyPath = (key: string) => path.join(bodies, `${encodeKey(key)}.bin`);
  const metaPath = (key: string) => path.join(metas, `${encodeKey(key)}.json`);

  const readMeta = async (key: string): Promise<StoredObject | null> => {
    try {
      // SAFETY: `put` writes this exact shape; a malformed file is treated as absent.
      return JSON.parse(await readFile(metaPath(key), "utf8")) as StoredObject;
    } catch {
      return null;
    }
  };

  const writeAtomic = async (target: string, data: string | Uint8Array) => {
    const temporary = `${target}.${randomUUID()}.tmp`;

    await writeFile(temporary, data, { mode: 0o600 });
    await rename(temporary, target);
  };

  return {
    async head(key) {
      const stored = await readMeta(key);

      return stored ? toObject(stored) : null;
    },

    async get(key, options) {
      const stored = await readMeta(key);

      if (!stored) return null;

      try {
        const bytes = new Uint8Array(await readFile(bodyPath(key)));

        return toBody(stored, rangeOf(bytes, options?.range));
      } catch {
        return null;
      }
    },

    async put(key, value, options) {
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

      await mkdir(bodies, { recursive: true, mode: 0o700 });
      await mkdir(metas, { recursive: true, mode: 0o700 });
      await writeAtomic(bodyPath(key), bytes);
      await writeAtomic(metaPath(key), JSON.stringify(stored));

      return toObject(stored);
    },

    async delete(keys) {
      const list = Schema.is(Schema.String)(keys) ? [keys] : keys;

      await Promise.all(
        list.flatMap((key) => [
          rm(bodyPath(key), { force: true }),
          rm(metaPath(key), { force: true }),
        ]),
      );
    },

    async list(options?: R2ListOptions): Promise<R2Objects> {
      const prefix = options?.prefix ?? "";
      const limit = Math.max(1, Math.min(options?.limit ?? 1000, 1000));

      let names: string[];

      try {
        names = await readdir(metas);
      } catch {
        return { objects: [], truncated: false, delimitedPrefixes: [] };
      }

      const stored: StoredObject[] = [];

      for (const name of names) {
        if (!name.endsWith(".json")) continue;

        try {
          // SAFETY: metadata is written by `put` with this shape; any other
          // content is ignored rather than listed.
          const item = JSON.parse(await readFile(path.join(metas, name), "utf8")) as StoredObject;

          if (item.key.startsWith(prefix)) stored.push(item);
        } catch {
          // A half-written metadata file is not a listed object.
        }
      }

      stored.sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0));

      const start = options?.cursor
        ? stored.findIndex(
            (item) => item.key > Buffer.from(options.cursor!, "base64url").toString("utf8"),
          )
        : 0;

      const slice = start < 0 ? [] : stored.slice(start, start + limit + 1);
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
          ? Buffer.from(page[page.length - 1]!.key, "utf8").toString("base64url")
          : undefined,
        delimitedPrefixes: [...delimitedPrefixes],
      };
    },
  };
};
