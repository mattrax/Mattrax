import { Data, Effect } from "effect";

/** Compact opaque identifier for rows and external references. */
export const newId = (): string => crypto.randomUUID().replaceAll("-", "").slice(0, 24);

const ALGORITHM: RsaHashedKeyGenParams = {
  name: "RSASSA-PKCS1-v1_5",
  hash: "SHA-256",
  modulusLength: 2048,
  publicExponent: new Uint8Array([1, 0, 1]),
};

const SIGN_ALGORITHM: Algorithm = { name: "RSASSA-PKCS1-v1_5" };

export class CryptoError extends Data.TaggedError("CryptoError")<{
  message: string;
  cause?: unknown;
}> {}

export async function generateCaKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(ALGORITHM, true, ["sign", "verify"]);
}

export async function exportPrivateKeyJwk(key: CryptoKey): Promise<JsonWebKey> {
  return crypto.subtle.exportKey("jwk", key);
}

export async function importPrivateKeyJwk(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey("jwk", jwk, ALGORITHM, true, ["sign"]);
}

export async function exportPublicKeySpki(key: CryptoKey): Promise<ArrayBuffer> {
  return crypto.subtle.exportKey("spki", key);
}

export async function signData(key: CryptoKey, data: ArrayBuffer): Promise<ArrayBuffer> {
  return crypto.subtle.sign(SIGN_ALGORITHM, key, data);
}

export async function sha256(data: ArrayBuffer): Promise<ArrayBuffer> {
  return crypto.subtle.digest("SHA-256", data);
}

/** Copy a typed array into a plain `ArrayBuffer` owned by the caller. */
export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);

  new Uint8Array(buffer).set(bytes);

  return buffer;
}

export function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";

  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }

  return btoa(binary);
}

export function arrayBufferToBase64(buf: ArrayBuffer): string {
  return uint8ArrayToBase64(new Uint8Array(buf));
}

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return toArrayBuffer(bytes);
}

export function pemEncode(label: string, der: ArrayBuffer): string {
  const base64 = arrayBufferToBase64(der);
  const lines = [`-----BEGIN ${label}-----`];

  for (let i = 0; i < base64.length; i += 64) {
    lines.push(base64.slice(i, i + 64));
  }

  lines.push(`-----END ${label}-----`);

  return lines.join("\n");
}

export function pemDecode(label: string, pem: string): ArrayBuffer {
  const header = `-----BEGIN ${label}-----`;
  const footer = `-----END ${label}-----`;
  const start = pem.indexOf(header);
  const end = pem.indexOf(footer);

  if (start === -1 || end === -1) {
    throw new Error(`PEM ${label} not found`);
  }

  const base64 = pem.slice(start + header.length, end).replaceAll(/\s/g, "");

  return base64ToArrayBuffer(base64);
}

// ─── Shared request signing ──────────────────────────────────────
//
// The product-key/licence handshake is HMAC-SHA256 over a UTF-8 message. Both
// the self-hosted gateway and the Cloud platform must use the same encoding:
// lowercase hex. (The gateway previously emitted base64url, so valid keys were
// rejected by the platform and the process exited.)

const encoder = new TextEncoder();

const bytesToHex = (bytes: ArrayBuffer): string =>
  Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");

/** HMAC-SHA256 as lowercase hex, matching the Platform API signature format. */
export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  return bytesToHex(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
}

/** Constant-time comparison for hex/ASCII signatures. */
export function constantTimeEqual(left: string, right: string): boolean {
  const a = encoder.encode(left);
  const b = encoder.encode(right);

  if (a.length !== b.length) return false;
  let difference = 0;

  for (let index = 0; index < a.length; index++) difference |= a[index] ^ b[index];

  return difference === 0;
}

/** Sign the licence-verification message used by `POST /instances/verify`. */
export const productKeyVerifyMessage = (
  timestamp: number | string,
  payload: { userCount?: number; deviceCount?: number },
): string => `${timestamp}.${payload.userCount ?? 0}:${payload.deviceCount ?? 0}`;

/** Sign a Platform API request; always emits lowercase hex. */
export async function signProductKeyRequest(secret: string, message: string): Promise<string> {
  return hmacSha256Hex(secret, message);
}

/** Verify a Platform API signature using the shared hex encoding. */
export async function verifyProductKeyRequest(
  secret: string,
  message: string,
  signature: string,
): Promise<boolean> {
  return constantTimeEqual(await hmacSha256Hex(secret, message), signature);
}

// ─── At-rest secret sealing ──────────────────────────────────────
//
// Secrets (APNs private keys) are sealed with AES-256-GCM using a key derived
// from an application secret (the API `AUTH_SECRET`). The output is a single
// base64 string containing `iv || ciphertext`, so it can be stored in a text
// column without any additional encoding.

const sealKey = async (secret: string): Promise<CryptoKey> => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));

  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
};

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = "";

  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);

  return btoa(binary);
};

const base64ToBytes = (value: string): Uint8Array => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  return bytes;
};

/** Encrypt a UTF-8 string at rest, returning a base64 `iv || ciphertext` payload. */
export async function sealSecret(secret: string, plaintext: string): Promise<string> {
  const key = await sealKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext)),
  );

  const combined = new Uint8Array(iv.byteLength + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(ciphertext, iv.byteLength);

  return bytesToBase64(combined);
}

/** Decrypt a payload produced by {@link sealSecret}. */
export async function openSecret(secret: string, sealed: string): Promise<string> {
  const combined = base64ToBytes(sealed);

  if (combined.byteLength <= 12) throw new Error("Sealed secret is malformed");
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const key = await sealKey(secret);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);

  return new TextDecoder().decode(plaintext);
}

// ─── Passphrase-sealed envelopes ─────────────────────────────────
//
// Device handover archives leave the deployment: an operator downloads one file
// and keeps it next to the returned hardware. The passphrase is supplied per
// export and never stored, so the at-rest key cannot be derived from anything
// Mattrax keeps. PBKDF2 makes an offline guess against a stolen file expensive;
// AES-GCM authenticates the header and ciphertext so a modified envelope is
// rejected instead of partially trusted.

/**
 * Version of the envelope produced by {@link sealWithPassphrase}. A future
 * format must bump this instead of silently changing the meaning of fields.
 */
export const PASSPHRASE_ENVELOPE_VERSION = 1;

/** OWASP's 2023 floor for PBKDF2-HMAC-SHA256 (600,000 iterations). */
export const PASSPHRASE_PBKDF2_ITERATIONS = 600_000;

/**
 * Refuse to open envelopes that claim a weaker work factor than this. A caller
 * cannot lower the cost by editing the header: tampering with the iteration
 * count also changes the derived key.
 */
export const PASSPHRASE_PBKDF2_MIN_ITERATIONS = 100_000;

const PASSPHRASE_SALT_BYTES = 16;
const PASSPHRASE_IV_BYTES = 12;
const PASSPHRASE_MAX_ITERATIONS = 5_000_000;
const PASSPHRASE_AAD = encoder.encode(
  `mattrax-passphrase-envelope:v${PASSPHRASE_ENVELOPE_VERSION}`,
);

export type PassphraseEnvelope = {
  /** Envelope format version; readers must reject versions they do not know. */
  readonly version: number;
  readonly kdf: {
    readonly name: "PBKDF2";
    readonly hash: "SHA-256";
    readonly iterations: number;
    /** Base64-encoded random salt. */
    readonly salt: string;
  };
  readonly cipher: {
    readonly name: "AES-GCM";
    /** Base64-encoded 96-bit nonce. */
    readonly iv: string;
  };
  /** Base64-encoded AES-GCM ciphertext, including the authentication tag. */
  readonly ciphertext: string;
};

/** Decode standard base64 and reject input that is not canonical base64. */
const strictBase64ToBytes = (value: string): Uint8Array => {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0)
    throw new Error("Passphrase envelope is not valid base64");

  return base64ToBytes(value);
};

const passphraseKey = async (
  passphrase: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> => {
  const material = await crypto.subtle.importKey(
    "raw",
    encoder.encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: toArrayBuffer(salt), iterations },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
};

/** Validate a decoded envelope before using any of its parameters. */
const assertPassphraseEnvelope = (value: PassphraseEnvelope): void => {
  if (value.version !== PASSPHRASE_ENVELOPE_VERSION)
    throw new Error(`Unsupported passphrase envelope version: ${value.version}`);

  if (value.kdf?.name !== "PBKDF2" || value.kdf.hash !== "SHA-256")
    throw new Error("Passphrase envelope uses an unsupported key derivation");

  if (value.cipher?.name !== "AES-GCM")
    throw new Error("Passphrase envelope uses an unsupported cipher");

  const iterations = value.kdf.iterations;

  if (
    !Number.isSafeInteger(iterations) ||
    iterations < PASSPHRASE_PBKDF2_MIN_ITERATIONS ||
    iterations > PASSPHRASE_MAX_ITERATIONS
  )
    throw new Error("Passphrase envelope has an unsupported work factor");

  const salt = strictBase64ToBytes(value.kdf.salt);
  const iv = strictBase64ToBytes(value.cipher.iv);
  const ciphertext = strictBase64ToBytes(value.ciphertext);

  if (salt.byteLength !== PASSPHRASE_SALT_BYTES)
    throw new Error("Passphrase envelope has a malformed salt");

  if (iv.byteLength !== PASSPHRASE_IV_BYTES)
    throw new Error("Passphrase envelope has a malformed nonce");

  if (ciphertext.byteLength <= 16)
    throw new Error("Passphrase envelope has a malformed ciphertext");
};

/**
 * Encrypt a UTF-8 string under an operator-supplied passphrase.
 *
 * The returned object is safe to hand to an untrusted channel: it contains the
 * KDF parameters and ciphertext, never the passphrase or a verifier for it.
 */
export async function sealWithPassphrase(
  passphrase: string,
  plaintext: string,
  options?: { readonly iterations?: number },
): Promise<PassphraseEnvelope> {
  if (passphrase.length === 0) throw new Error("A passphrase is required");

  const iterations = options?.iterations ?? PASSPHRASE_PBKDF2_ITERATIONS;

  if (
    !Number.isSafeInteger(iterations) ||
    iterations < PASSPHRASE_PBKDF2_MIN_ITERATIONS ||
    iterations > PASSPHRASE_MAX_ITERATIONS
  )
    throw new Error("The passphrase work factor is out of range");

  const salt = crypto.getRandomValues(new Uint8Array(PASSPHRASE_SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(PASSPHRASE_IV_BYTES));
  const key = await passphraseKey(passphrase, salt, iterations);

  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: PASSPHRASE_AAD },
      key,
      encoder.encode(plaintext),
    ),
  );

  return {
    version: PASSPHRASE_ENVELOPE_VERSION,
    kdf: {
      name: "PBKDF2",
      hash: "SHA-256",
      iterations,
      salt: bytesToBase64(salt),
    },
    cipher: { name: "AES-GCM", iv: bytesToBase64(iv) },
    ciphertext: bytesToBase64(ciphertext),
  };
}

/**
 * Decrypt a payload produced by {@link sealWithPassphrase}.
 *
 * A wrong passphrase, a modified header and a modified ciphertext all fail the
 * same way: AES-GCM authentication rejects them. The error never includes the
 * passphrase or plaintext.
 */
export async function openWithPassphrase(
  passphrase: string,
  envelope: PassphraseEnvelope,
): Promise<string> {
  assertPassphraseEnvelope(envelope);

  const key = await passphraseKey(
    passphrase,
    strictBase64ToBytes(envelope.kdf.salt),
    envelope.kdf.iterations,
  );

  let plaintext: ArrayBuffer;

  try {
    plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: toArrayBuffer(strictBase64ToBytes(envelope.cipher.iv)),
        additionalData: PASSPHRASE_AAD,
      },
      key,
      toArrayBuffer(strictBase64ToBytes(envelope.ciphertext)),
    );
  } catch {
    throw new Error("The passphrase is incorrect or the archive has been modified");
  }

  return new TextDecoder().decode(plaintext);
}

// ─── Short-lived scoped tokens ───────────────────────────────────
//
// A handover archive download is a one-time R2 read. The signed token carries
// its own expiry and is bound to the archive id, so a copied URL stops working
// without another database write. It is not a replacement for authentication:
// the download endpoint still resolves the tenant membership and permission.

const scopedTokenMessage = (scope: string, id: string, expiresAt: number): string =>
  `${scope}:${id}:${expiresAt}`;

/** Sign an expiring token for one scoped resource, e.g. a handover archive. */
export async function signScopedToken(
  secret: string,
  scope: string,
  id: string,
  expiresAt: number,
): Promise<string> {
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= 0)
    throw new Error("Token expiry must be a positive Unix timestamp");

  const signature = await hmacSha256Hex(secret, scopedTokenMessage(scope, id, expiresAt));

  return `${expiresAt}.${signature}`;
}

/**
 * Verify a token produced by {@link signScopedToken}. Returns false for a
 * malformed, expired, or differently scoped token; callers must still check
 * that the resource belongs to the authenticated tenant.
 */
export async function verifyScopedToken(
  secret: string,
  scope: string,
  id: string,
  token: string,
  now: number = Date.now(),
): Promise<boolean> {
  const separator = token.indexOf(".");

  if (separator <= 0) return false;

  const encodedExpiry = token.slice(0, separator);
  const signature = token.slice(separator + 1);

  if (!/^\d{1,12}$/.test(encodedExpiry) || signature.length === 0 || signature.includes("."))
    return false;

  const expiresAt = Number(encodedExpiry);

  if (expiresAt * 1000 <= now) return false;

  return constantTimeEqual(
    await hmacSha256Hex(secret, scopedTokenMessage(scope, id, expiresAt)),
    signature,
  );
}

const cryptoEffect = <A>(
  operation: string,
  evaluate: () => PromiseLike<A>,
): Effect.Effect<A, CryptoError> =>
  Effect.tryPromise({
    try: evaluate,
    catch: (cause) =>
      new CryptoError({
        message: cause instanceof Error ? cause.message : `${operation} failed`,
        cause,
      }),
  });

/**
 * Effect-native crypto operations. Every fallible operation reports a
 * {@link CryptoError} in the error channel, so callers do not turn routine key
 * or ciphertext failures into defects with `Effect.promise`.
 *
 * The Promise functions above remain for non-Effect consumers. New Effect code
 * should use this namespace.
 */
export const Crypto = {
  generateCaKeyPair: () => cryptoEffect("generateCaKeyPair", generateCaKeyPair),
  exportPrivateKeyJwk: (key: CryptoKey) =>
    cryptoEffect("exportPrivateKeyJwk", () => exportPrivateKeyJwk(key)),
  importPrivateKeyJwk: (jwk: JsonWebKey) =>
    cryptoEffect("importPrivateKeyJwk", () => importPrivateKeyJwk(jwk)),
  exportPublicKeySpki: (key: CryptoKey) =>
    cryptoEffect("exportPublicKeySpki", () => exportPublicKeySpki(key)),
  signData: (key: CryptoKey, data: ArrayBuffer) =>
    cryptoEffect("signData", () => signData(key, data)),
  sha256: (data: ArrayBuffer) => cryptoEffect("sha256", () => sha256(data)),
  hmacSha256Hex: (secret: string, message: string) =>
    cryptoEffect("hmacSha256Hex", () => hmacSha256Hex(secret, message)),
  signProductKeyRequest: (secret: string, message: string) =>
    cryptoEffect("signProductKeyRequest", () => signProductKeyRequest(secret, message)),
  verifyProductKeyRequest: (secret: string, message: string, signature: string) =>
    cryptoEffect("verifyProductKeyRequest", () =>
      verifyProductKeyRequest(secret, message, signature),
    ),
  sealSecret: (secret: string, plaintext: string) =>
    cryptoEffect("sealSecret", () => sealSecret(secret, plaintext)),
  openSecret: (secret: string, sealed: string) =>
    cryptoEffect("openSecret", () => openSecret(secret, sealed)),
  sealWithPassphrase: (
    passphrase: string,
    plaintext: string,
    options?: { readonly iterations?: number },
  ) => cryptoEffect("sealWithPassphrase", () => sealWithPassphrase(passphrase, plaintext, options)),
  openWithPassphrase: (passphrase: string, envelope: PassphraseEnvelope) =>
    cryptoEffect("openWithPassphrase", () => openWithPassphrase(passphrase, envelope)),
  signScopedToken: (secret: string, scope: string, id: string, expiresAt: number) =>
    cryptoEffect("signScopedToken", () => signScopedToken(secret, scope, id, expiresAt)),
  verifyScopedToken: (secret: string, scope: string, id: string, token: string, now?: number) =>
    cryptoEffect("verifyScopedToken", () => verifyScopedToken(secret, scope, id, token, now)),
  pemDecode: (label: string, pem: string): Effect.Effect<ArrayBuffer, CryptoError> =>
    Effect.try({
      try: () => pemDecode(label, pem),
      catch: (cause) =>
        new CryptoError({
          message: cause instanceof Error ? cause.message : `Failed to decode PEM ${label}`,
          cause,
        }),
    }),
} as const;
