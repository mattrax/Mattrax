import { Effect, Schema } from "effect";
import { Crypto } from "@mattrax/crypto";
import type { CryptoError } from "@mattrax/crypto";

const hex = (bytes: ArrayBuffer): string =>
  Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();

/** Content hash used for declaration server tokens and persisted policy data. */
export const policyDataHashEffect = (value: Schema.Json): Effect.Effect<string, CryptoError> =>
  Crypto.sha256(new TextEncoder().encode(JSON.stringify(value)).buffer).pipe(Effect.map(hex));
