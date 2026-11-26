import { Effect } from "effect";
import { ScepError } from "./schema.js";
import {
  Crypto,
  arrayBufferToBase64 as arrayBufferToBase64Raw,
  base64ToArrayBuffer as base64ToArrayBufferRaw,
  pemEncode as pemEncodeRaw,
  pemDecode as pemDecodeRaw,
} from "@mattrax/crypto";

const internalCryptoError =
  (message: string) =>
  (cause: unknown): ScepError =>
    new ScepError({ message, reason: "internal", cause });

export const generateCaKeyPair = (): Effect.Effect<CryptoKeyPair, ScepError> =>
  Crypto.generateCaKeyPair().pipe(
    Effect.mapError(internalCryptoError("Failed to generate CA key pair")),
  );

export const exportPrivateKeyJwk = (key: CryptoKey): Effect.Effect<JsonWebKey, ScepError> =>
  Crypto.exportPrivateKeyJwk(key).pipe(
    Effect.mapError(internalCryptoError("Failed to export private key")),
  );

export const importPrivateKeyJwk = (jwk: JsonWebKey): Effect.Effect<CryptoKey, ScepError> =>
  Crypto.importPrivateKeyJwk(jwk).pipe(
    Effect.mapError(internalCryptoError("Failed to import private key")),
  );

/**
 * Import an unencrypted PKCS#8 RSA private key (PEM) as an exportable JWK.
 *
 * Used for an operator-supplied tenant CA: the key must be importable as a
 * signing key before it is stored, and the JWK form is what the CA repository
 * persists.
 */
export const importPrivateKeyPem = (pem: string): Effect.Effect<JsonWebKey, ScepError> =>
  Effect.gen(function* () {
    const der = yield* Crypto.pemDecode("PRIVATE KEY", pem).pipe(
      Effect.mapError(
        internalCryptoError(
          "The SCEP CA key is not an unencrypted PKCS#8 PEM private key (expected -----BEGIN PRIVATE KEY-----)",
        ),
      ),
    );

    const key = yield* Effect.tryPromise({
      try: () =>
        crypto.subtle.importKey(
          "pkcs8",
          der,
          { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
          true,
          ["sign"],
        ),
      catch: internalCryptoError("The SCEP CA key could not be imported"),
    });

    return yield* exportPrivateKeyJwk(key);
  });

export const exportPublicKeySpki = (key: CryptoKey): Effect.Effect<ArrayBuffer, ScepError> =>
  Crypto.exportPublicKeySpki(key).pipe(
    Effect.mapError(internalCryptoError("Failed to export public key")),
  );

export const signData = (
  key: CryptoKey,
  data: ArrayBuffer,
): Effect.Effect<ArrayBuffer, ScepError> =>
  Crypto.signData(key, data).pipe(Effect.mapError(internalCryptoError("Failed to sign data")));

export const sha256 = (data: ArrayBuffer): Effect.Effect<ArrayBuffer, ScepError> =>
  Crypto.sha256(data).pipe(Effect.mapError(internalCryptoError("Failed to hash data")));

/**
 * A cryptographically-random X.509 serial number.
 *
 * 128 bits with the top bit cleared, so the DER INTEGER is always positive and
 * the serial cannot alias the CA's small fixed serial. This replaces the old
 * 31-bit `Math.random()` serials, where an accidental collision was plausible
 * and a collision could overwrite another identity's issuance record.
 */
export const randomCertificateSerial = (): ArrayBuffer => {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[0] = bytes[0] & 0x7f;

  // X.509 serials must be positive and non-zero.
  if (bytes.every((byte) => byte === 0)) bytes[bytes.length - 1] = 1;

  return bytes.buffer;
};

export const arrayBufferToBase64 = arrayBufferToBase64Raw;

export const base64ToArrayBuffer = base64ToArrayBufferRaw;

export const pemEncode = pemEncodeRaw;

export const pemDecode = pemDecodeRaw;
