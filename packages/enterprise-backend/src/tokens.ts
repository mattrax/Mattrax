import { Effect } from "effect";

const bytesToBase64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");

const base64UrlToBytes = (value: string) =>
  Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), (char) =>
    char.charCodeAt(0),
  );

export const signToken = (secret: string, payload: Record<string, unknown>) =>
  Effect.promise(async () => {
    const body = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
    return `${body}.${bytesToBase64Url(new Uint8Array(signature))}`;
  });

export type TokenPayload = {
  sub: string;
  email: string;
  exp: number;
  purpose?: string;
  tenantId?: string;
  nonce?: string;
  /** Serial number bound into an ADE enrollment-profile link. */
  serial?: string;
  /** ADE profile UUID the link was minted for. */
  profileUuid?: string;
  /** Session the token is bound to (step-up grants and flow bindings). */
  sid?: string;
  /** Step-up action this token authorises. */
  action?: string;
  /** Passkey step-up flow id. */
  flowId?: string;
  /** Passkey step-up request-binding verifier. */
  verifier?: string;
  /** Absolute expiry of the passkey step-up request binding. */
  requestBindingExpiresAtMillis?: number;
};

export const verifyToken = (secret: string, token: string) =>
  Effect.promise(async () => {
    const [body, signature] = token.split(".");
    if (!body || !signature) throw new Error("Malformed token");
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      base64UrlToBytes(signature),
      new TextEncoder().encode(body),
    );
    if (!valid) throw new Error("Invalid token");
    const payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(body))) as unknown;
    if (
      typeof payload !== "object" ||
      payload === null ||
      typeof (payload as Record<string, unknown>).sub !== "string" ||
      typeof (payload as Record<string, unknown>).email !== "string" ||
      typeof (payload as Record<string, unknown>).exp !== "number"
    )
      throw new Error("Invalid token");
    return payload as TokenPayload;
  });
