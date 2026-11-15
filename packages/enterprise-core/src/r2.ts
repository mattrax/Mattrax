import { Context, Effect, Layer, Schema } from "effect";

export type R2PutValue = ReadableStream | ArrayBuffer | ArrayBufferView | string | null | Blob;

export type R2HttpMetadata = {
  readonly contentType?: string;
  readonly contentLanguage?: string;
  readonly contentDisposition?: string;
  readonly contentEncoding?: string;
  readonly cacheControl?: string;
  readonly cacheExpiry?: Date;
};

export type R2PutOptions = {
  readonly httpMetadata?: R2HttpMetadata;
  readonly customMetadata?: Record<string, string>;
  readonly md5?: ArrayBuffer | string;
  readonly sha1?: ArrayBuffer | string;
  readonly sha256?: ArrayBuffer | string;
  readonly sha384?: ArrayBuffer | string;
  readonly sha512?: ArrayBuffer | string;
};

export type R2GetOptions = {
  readonly onlyIf?: unknown;
  readonly range?: unknown;
};

export type R2ListOptions = {
  readonly limit?: number;
  readonly prefix?: string;
  readonly cursor?: string;
  readonly delimiter?: string;
  readonly include?: ReadonlyArray<"httpMetadata" | "customMetadata">;
};

export type R2Object = {
  readonly key: string;
  readonly version: string;
  readonly size: number;
  readonly etag: string;
  readonly httpEtag: string;
  readonly uploaded: Date;
  readonly httpMetadata?: R2HttpMetadata;
  readonly customMetadata?: Record<string, string>;
  readonly checksums?: unknown;
};

export type R2ObjectBody = R2Object & {
  readonly body: ReadableStream;
  readonly bodyUsed: boolean;
  readonly arrayBuffer: () => Promise<ArrayBuffer>;
  readonly text: () => Promise<string>;
  readonly json: <T = unknown>() => Promise<T>;
  readonly blob: () => Promise<Blob>;
};

export type R2Objects = {
  readonly objects: ReadonlyArray<R2Object>;
  readonly truncated: boolean;
  readonly cursor?: string;
  readonly delimitedPrefixes: ReadonlyArray<string>;
};

export type R2Bucket = {
  readonly head: (key: string) => Promise<R2Object | null>;
  readonly get: (key: string, options?: R2GetOptions) => Promise<R2ObjectBody | null>;
  readonly put: (key: string, value: R2PutValue, options?: R2PutOptions) => Promise<R2Object>;
  readonly delete: (keys: string | ReadonlyArray<string>) => Promise<void>;
  readonly list: (options?: R2ListOptions) => Promise<R2Objects>;
};

export class R2FileNotFound extends Schema.TaggedError<R2FileNotFound>()("R2FileNotFound", {
  message: Schema.String,
}) {}

export class R2InternalError extends Schema.TaggedError<R2InternalError>()("R2InternalError", {
  message: Schema.String,
}) {}

export type R2Error = R2FileNotFound | R2InternalError;

export declare namespace R2 {
  export type Service = {
    readonly put: (
      key: string,
      value: R2PutValue,
      options?: R2PutOptions,
    ) => Effect.Effect<R2Object, R2InternalError>;
    readonly get: (
      key: string,
      options?: R2GetOptions,
    ) => Effect.Effect<R2ObjectBody, R2FileNotFound | R2InternalError>;
    readonly head: (key: string) => Effect.Effect<R2Object, R2FileNotFound | R2InternalError>;
    readonly delete: (keys: string | ReadonlyArray<string>) => Effect.Effect<void, R2InternalError>;
    readonly list: (options?: R2ListOptions) => Effect.Effect<R2Objects, R2InternalError>;
    readonly arrayBuffer: (object: R2ObjectBody) => Effect.Effect<ArrayBuffer, R2InternalError>;
  };
}

/**
 * String fields provider SDKs and R2 errors use to explain a failure. All are
 * optional: a caught value only has to be an object, and a missing or non-string
 * field reads as absent.
 */
const ErrorFields = Schema.Struct({
  message: Schema.optional(Schema.String),
  code: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
});

type ErrorField = "message" | "code" | "name";

const stringField = (cause: unknown, field: ErrorField): string | undefined => {
  if (!Schema.is(ErrorFields)(cause)) return undefined;

  return cause[field];
};

export const toR2Error = (cause: unknown): R2Error => {
  if (cause instanceof R2FileNotFound || cause instanceof R2InternalError) return cause;

  const message =
    cause instanceof Error
      ? cause.message
      : (stringField(cause, "message") ?? "R2 operation failed");

  const code = stringField(cause, "code") ?? stringField(cause, "name");

  if (code === "NoSuchKey" || code === "NotFound" || code === "404" || /not found/i.test(message)) {
    return new R2FileNotFound({ message });
  }

  return new R2InternalError({ message: "R2 operation failed" });
};

const toR2InternalError = (cause: unknown): R2InternalError => {
  const error = toR2Error(cause);

  return error instanceof R2InternalError ? error : new R2InternalError({ message: error.message });
};

export class R2 extends Context.Service<R2, R2.Service>()("@mattrax/enterprise-core/R2") {
  static readonly make = (bucket: R2Bucket): R2.Service => ({
    put: Effect.fn("R2.put")(function* (key, value, options) {
      return yield* Effect.tryPromise({
        try: () => bucket.put(key, value, options),
        catch: toR2InternalError,
      });
    }),

    get: Effect.fn("R2.get")(function* (key, options) {
      const object = yield* Effect.tryPromise({
        try: () => bucket.get(key, options),
        catch: toR2Error,
      });

      if (object === null) {
        return yield* new R2FileNotFound({ message: `R2 object not found: ${key}` });
      }

      return object;
    }),

    head: Effect.fn("R2.head")(function* (key) {
      const object = yield* Effect.tryPromise({
        try: () => bucket.head(key),
        catch: toR2Error,
      });

      if (object === null) {
        return yield* new R2FileNotFound({ message: `R2 object not found: ${key}` });
      }

      return object;
    }),

    delete: Effect.fn("R2.delete")(function* (keys) {
      return yield* Effect.tryPromise({
        try: () => bucket.delete(keys),
        catch: toR2InternalError,
      });
    }),

    list: Effect.fn("R2.list")(function* (options) {
      return yield* Effect.tryPromise({
        try: () => bucket.list(options),
        catch: toR2InternalError,
      });
    }),

    arrayBuffer: Effect.fn("R2.arrayBuffer")(function* (object) {
      return yield* Effect.tryPromise({
        try: () => object.arrayBuffer(),
        catch: toR2InternalError,
      });
    }),
  });

  static readonly layer = (bucket: R2Bucket): Layer.Layer<R2> => Layer.succeed(R2, R2.make(bucket));
}
