import { Data } from "effect";

const ALGORITHM: any = {
  name: "RSASSA-PKCS1-v1_5",
  hash: "SHA-256",
  modulusLength: 2048,
  publicExponent: new Uint8Array([1, 0, 1]),
};
const SIGN_ALGORITHM: any = { name: "RSASSA-PKCS1-v1_5" };

export class CryptoError extends Data.TaggedError("CryptoError")<{
  message: string;
  cause?: unknown;
}> {}

export async function generateCaKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(ALGORITHM, true, ["sign", "verify"]) as Promise<CryptoKeyPair>;
}

export async function exportPrivateKeyJwk(key: CryptoKey): Promise<JsonWebKey> {
  return crypto.subtle.exportKey("jwk", key) as Promise<JsonWebKey>;
}

export async function importPrivateKeyJwk(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey("jwk", jwk, ALGORITHM, true, ["sign"]) as Promise<CryptoKey>;
}

export async function exportPublicKeySpki(key: CryptoKey): Promise<ArrayBuffer> {
  return crypto.subtle.exportKey("spki", key) as Promise<ArrayBuffer>;
}

export async function signData(key: CryptoKey, data: ArrayBuffer): Promise<ArrayBuffer> {
  return crypto.subtle.sign(SIGN_ALGORITHM, key, data) as Promise<ArrayBuffer>;
}

export async function sha256(data: ArrayBuffer): Promise<ArrayBuffer> {
  return crypto.subtle.digest("SHA-256", data) as Promise<ArrayBuffer>;
}

export function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer as ArrayBuffer;
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
  const base64 = pem.slice(start + header.length, end).replace(/\s/g, "");
  return base64ToArrayBuffer(base64);
}

// ─── At-rest secret sealing ──────────────────────────────────────
//
// Secrets (APNs private keys) are sealed with AES-256-GCM using a key derived
// from an application secret (the API `AUTH_SECRET`). The output is a single
// base64 string containing `iv || ciphertext`, so it can be stored in a text
// column without any additional encoding.

const sealKey = async (secret: string): Promise<CryptoKey> => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
};

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]!);
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
