import { Data } from "effect";
import { openSecret, sealSecret } from "@mattrax/crypto";

/**
 * At-rest protection for the global SCEP CA private key.
 *
 * The key is an RSA JWK with full signing power over every tenant's device
 * identities, so it must never be persisted as plaintext. It is sealed with
 * AES-256-GCM keyed from the application secret (`AUTH_SECRET`) and stored in
 * the existing JSON/text column as a versioned envelope:
 *
 * ```json
 * { "v": 1, "sealed": "base64(iv || ciphertext)" }
 * ```
 *
 * Rows written before this existed hold a plaintext JWK. They are migrated on
 * read (see {@link openCaPrivateKey}), which keeps existing CA certificates
 * valid: sealing only changes the representation, never the key material.
 */

export const SCEP_CA_KEY_ENVELOPE_VERSION = 1;

export type SealedCaPrivateKey = {
  readonly v: typeof SCEP_CA_KEY_ENVELOPE_VERSION;
  readonly sealed: string;
};

export type ScepCaKeyErrorReason =
  | "missing_secret"
  | "invalid"
  | "decrypt_failed"
  | "seal_failed"
  | "serialize_failed";

/**
 * A CA key storage error. Messages and fields are deliberately secret-free:
 * this error may be logged, persisted or returned by an operator-facing health
 * check, so it must never carry ciphertext, plaintext or the JWK.
 */
export class ScepCaKeyError extends Data.TaggedError("ScepCaKeyError")<{
  readonly message: string;
  readonly reason: ScepCaKeyErrorReason;
}> {}

export type OpenedCaPrivateKey = {
  /** The unsealed signing key. */
  readonly privateKeyJwk: JsonWebKey;
  /**
   * Set when the stored value was a legacy plaintext JWK. Callers must persist
   * this envelope (replacing the plaintext row) before using the key. Absent
   * when the stored value was already sealed.
   */
  readonly migrated?: SealedCaPrivateKey;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A structural check for an RSA private JWK. */
export const isPrivateRsaJwk = (value: unknown): value is JsonWebKey =>
  isRecord(value) &&
  value.kty === "RSA" &&
  typeof value.n === "string" &&
  value.n.length > 0 &&
  typeof value.d === "string" &&
  value.d.length > 0;

/** Whether a stored column value is the current sealed envelope. */
export const isSealedCaPrivateKey = (value: unknown): value is SealedCaPrivateKey =>
  isRecord(value) &&
  value.v === SCEP_CA_KEY_ENVELOPE_VERSION &&
  typeof value.sealed === "string" &&
  value.sealed.length > 0;

const requireSecret = (authSecret: string | undefined): string => {
  const secret = authSecret?.trim();
  if (!secret) {
    throw new ScepCaKeyError({
      message:
        "SCEP CA private key protection is not configured: set AUTH_SECRET (or MATTRAX_AUTH_SECRET). Refusing to read or write the CA key without it.",
      reason: "missing_secret",
    });
  }
  return secret;
};

/**
 * Serialize a plaintext key into the stored envelope. The caller is
 * responsible for writing it to the database.
 */
export const sealCaPrivateKey = async (
  authSecret: string | undefined,
  privateKeyJwk: JsonWebKey,
): Promise<SealedCaPrivateKey> => {
  const secret = requireSecret(authSecret);
  let serialized: string;
  try {
    serialized = JSON.stringify(privateKeyJwk);
  } catch {
    throw new ScepCaKeyError({
      message: "Failed to serialize the SCEP CA private key",
      reason: "serialize_failed",
    });
  }
  try {
    return {
      v: SCEP_CA_KEY_ENVELOPE_VERSION,
      sealed: await sealSecret(secret, serialized),
    };
  } catch {
    // Never attach the cause: some runtimes include input material in errors.
    throw new ScepCaKeyError({
      message: "Failed to encrypt the SCEP CA private key",
      reason: "seal_failed",
    });
  }
};

/**
 * Read a stored CA private key, accepting both the sealed envelope and the
 * legacy plaintext JWK (and the JSON text form used by D1).
 *
 * Fails closed with a {@link ScepCaKeyError} when no application secret is
 * configured or the sealed value cannot be opened. It never invents a new key:
 * callers that see an error must not regenerate the CA, because that would
 * invalidate every device identity issued so far.
 */
export const openCaPrivateKey = async (
  stored: unknown,
  authSecret: string | undefined,
): Promise<OpenedCaPrivateKey> => {
  let value = stored;

  // D1 and some filesystem rows store the column as JSON text.
  if (typeof value === "string") {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      throw new ScepCaKeyError({
        message: "Stored SCEP CA private key is not valid JSON",
        reason: "invalid",
      });
    }
  }

  if (isSealedCaPrivateKey(value)) {
    const secret = requireSecret(authSecret);
    let plaintext: string;
    try {
      plaintext = await openSecret(secret, value.sealed);
    } catch {
      // No cause: a decrypt failure must not leak ciphertext into logs.
      throw new ScepCaKeyError({
        message:
          "Failed to decrypt the stored SCEP CA private key. It was sealed with a different application secret (was AUTH_SECRET rotated?) or the value is corrupted. The CA will not be regenerated.",
        reason: "decrypt_failed",
      });
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(plaintext) as unknown;
    } catch {
      throw new ScepCaKeyError({
        message: "Decrypted SCEP CA private key is not valid JSON",
        reason: "invalid",
      });
    }
    if (!isPrivateRsaJwk(parsed)) {
      throw new ScepCaKeyError({
        message: "Decrypted SCEP CA private key is not a valid RSA private JWK",
        reason: "invalid",
      });
    }
    return { privateKeyJwk: parsed };
  }

  if (isPrivateRsaJwk(value)) {
    // Legacy plaintext row: seal it and tell the caller to persist the result.
    const migrated = await sealCaPrivateKey(authSecret, value);
    return { privateKeyJwk: value, migrated };
  }

  throw new ScepCaKeyError({
    message: "Stored SCEP CA private key is invalid",
    reason: "invalid",
  });
};
