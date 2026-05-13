import { Context, Effect, Layer } from "effect";
import {
  EnterpriseR2FileNotFound,
  EnterpriseR2InternalError,
} from "@mattrax/enterprise-domain";

export const sha256Hex = (bytes: ArrayBuffer) => Effect.promise(async () => {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
});

export const base64ToBytes = (base64: string) => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
};

export const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

export type R2StorageShape = {
  readonly put: (key: string, bytes: Uint8Array, options?: unknown) => Effect.Effect<void, EnterpriseR2InternalError>;
  readonly get: (key: string) => Effect.Effect<any, EnterpriseR2FileNotFound | EnterpriseR2InternalError>;
  readonly arrayBuffer: (object: any) => Effect.Effect<ArrayBuffer, EnterpriseR2InternalError>;
};

export class R2Storage extends Context.Service<R2Storage, R2StorageShape>()("R2Storage") {}

const stringField = (value: unknown, field: string) => typeof value === "object" && value !== null && typeof (value as Record<string, unknown>)[field] === "string"
  ? (value as Record<string, string>)[field]
  : undefined;

export const toR2Error = (cause: unknown) => {
  if (cause instanceof EnterpriseR2FileNotFound || cause instanceof EnterpriseR2InternalError) return cause;

  const message = cause instanceof Error ? cause.message : stringField(cause, "message") ?? "R2 operation failed";
  const code = stringField(cause, "code") ?? stringField(cause, "name");

  if (code === "NoSuchKey" || code === "NotFound" || code === "404" || /not found/i.test(message)) {
    return new EnterpriseR2FileNotFound({ message });
  }

  return new EnterpriseR2InternalError({ message: "R2 operation failed" });
};

export const makeR2Storage = (bucket: any): R2StorageShape => ({
  put: (key, bytes, options) => Effect.tryPromise({
    try: async () => {
      await bucket.put(key, bytes, options);
    },
    catch: (cause) => {
      const error = toR2Error(cause);
      return error instanceof EnterpriseR2FileNotFound ? new EnterpriseR2InternalError({ message: error.message }) : error;
    },
  }),
  get: (key) => Effect.tryPromise({
    try: async () => {
      const object = await bucket.get(key);
      if (!object) throw new EnterpriseR2FileNotFound({ message: "Policy application file not found" });
      return object;
    },
    catch: toR2Error,
  }),
  arrayBuffer: (object) => Effect.tryPromise({
    try: () => object.arrayBuffer(),
    catch: (cause) => {
      const error = toR2Error(cause);
      return error instanceof EnterpriseR2FileNotFound ? new EnterpriseR2InternalError({ message: error.message }) : error;
    },
  }),
});

export const R2StorageLive = (bucket: any) => Layer.succeed(R2Storage, makeR2Storage(bucket));
