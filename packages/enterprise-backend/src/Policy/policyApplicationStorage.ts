import { Effect } from "effect";
import { R2 } from "@mattrax/enterprise-core";
import type { R2Bucket, R2ObjectBody, R2PutOptions } from "@mattrax/enterprise-core";

export type { R2Bucket, R2ObjectBody, R2PutOptions };

/** The storage layer used to persist policy application binaries. */
export const R2Storage = R2;

export const R2StorageLive = (bucket: R2Bucket) => R2.layer(bucket);

export const base64ToBytes = (value: string): Uint8Array => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
};

export const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
};

export const sha256Hex = (data: ArrayBuffer): Effect.Effect<string> =>
  Effect.promise(() => crypto.subtle.digest("SHA-256", data)).pipe(
    Effect.map((digest) =>
      Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(""),
    ),
  );
