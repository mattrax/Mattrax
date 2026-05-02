import { Effect } from "effect";
import { ScepError } from "./schema.js";
import {
  generateCaKeyPair as generateCaKeyPairRaw,
  exportPrivateKeyJwk as exportPrivateKeyJwkRaw,
  importPrivateKeyJwk as importPrivateKeyJwkRaw,
  exportPublicKeySpki as exportPublicKeySpkiRaw,
  signData as signDataRaw,
  sha256 as sha256Raw,
  arrayBufferToBase64 as arrayBufferToBase64Raw,
  base64ToArrayBuffer as base64ToArrayBufferRaw,
  pemEncode as pemEncodeRaw,
  pemDecode as pemDecodeRaw,
} from "@mattrax/crypto";

export const generateCaKeyPair = (): Effect.Effect<CryptoKeyPair, ScepError> =>
  Effect.tryPromise({
    try: () => generateCaKeyPairRaw(),
    catch: (cause) => new ScepError({ message: "Failed to generate CA key pair", cause }),
  });

export const exportPrivateKeyJwk = (key: CryptoKey): Effect.Effect<JsonWebKey, ScepError> =>
  Effect.tryPromise({
    try: () => exportPrivateKeyJwkRaw(key),
    catch: (cause) => new ScepError({ message: "Failed to export private key", cause }),
  });

export const importPrivateKeyJwk = (jwk: JsonWebKey): Effect.Effect<CryptoKey, ScepError> =>
  Effect.tryPromise({
    try: () => importPrivateKeyJwkRaw(jwk),
    catch: (cause) => new ScepError({ message: "Failed to import private key", cause }),
  });

export const exportPublicKeySpki = (key: CryptoKey): Effect.Effect<ArrayBuffer, ScepError> =>
  Effect.tryPromise({
    try: () => exportPublicKeySpkiRaw(key),
    catch: (cause) => new ScepError({ message: "Failed to export public key", cause }),
  });

export const signData = (key: CryptoKey, data: ArrayBuffer): Effect.Effect<ArrayBuffer, ScepError> =>
  Effect.tryPromise({
    try: () => signDataRaw(key, data),
    catch: (cause) => new ScepError({ message: "Failed to sign data", cause }),
  });

export const sha256 = (data: ArrayBuffer): Effect.Effect<ArrayBuffer, ScepError> =>
  Effect.tryPromise({
    try: () => sha256Raw(data),
    catch: (cause) => new ScepError({ message: "Failed to hash data", cause }),
  });

export const arrayBufferToBase64 = arrayBufferToBase64Raw;
export const base64ToArrayBuffer = base64ToArrayBufferRaw;
export const pemEncode = pemEncodeRaw;
export const pemDecode = pemDecodeRaw;
