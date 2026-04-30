import { Effect } from "effect";
import { ScepError } from "../schema";

const ALGORITHM: any = {
  name: "RSASSA-PKCS1-v1_5",
  hash: "SHA-256",
  modulusLength: 2048,
  publicExponent: new Uint8Array([1, 0, 1]),
};
const SIGN_ALGORITHM: any = { name: "RSASSA-PKCS1-v1_5" };

export const generateCaKeyPair = (): Effect.Effect<CryptoKeyPair, ScepError> =>
  Effect.tryPromise({
    try: async () => {
      const key = await crypto.subtle.generateKey(ALGORITHM, true, ["sign", "verify"]);
      return key as CryptoKeyPair;
    },
    catch: (cause) => new ScepError({ message: "Failed to generate CA key pair", cause }),
  });

export const exportPrivateKeyJwk = (key: CryptoKey): Effect.Effect<JsonWebKey, ScepError> =>
  Effect.tryPromise({
    try: async () => {
      const jwk = await crypto.subtle.exportKey("jwk", key);
      return jwk as JsonWebKey;
    },
    catch: (cause) => new ScepError({ message: "Failed to export private key", cause }),
  });

export const importPrivateKeyJwk = (jwk: JsonWebKey): Effect.Effect<CryptoKey, ScepError> =>
  Effect.tryPromise({
    try: async () => {
      const key = await crypto.subtle.importKey("jwk", jwk, ALGORITHM, true, ["sign"]);
      return key as CryptoKey;
    },
    catch: (cause) => new ScepError({ message: "Failed to import private key", cause }),
  });


export const exportPublicKeySpki = (key: CryptoKey): Effect.Effect<ArrayBuffer, ScepError> =>
  Effect.tryPromise({
    try: async () => {
      const buf = await crypto.subtle.exportKey("spki", key);
      return buf as ArrayBuffer;
    },
    catch: (cause) => new ScepError({ message: "Failed to export public key", cause }),
  });

export const signData = (key: CryptoKey, data: ArrayBuffer): Effect.Effect<ArrayBuffer, ScepError> =>
  Effect.tryPromise({
    try: async () => {
      const sig = await crypto.subtle.sign(SIGN_ALGORITHM, key, data);
      return sig as ArrayBuffer;
    },
    catch: (cause) => new ScepError({ message: "Failed to sign data", cause }),
  });

export const sha256 = (data: ArrayBuffer): Effect.Effect<ArrayBuffer, ScepError> =>
  Effect.tryPromise({
    try: async () => {
      const hash = await crypto.subtle.digest("SHA-256", data);
      return hash as ArrayBuffer;
    },
    catch: (cause) => new ScepError({ message: "Failed to hash data", cause }),
  });

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
