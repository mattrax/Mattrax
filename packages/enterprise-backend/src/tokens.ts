import { Effect, Schema } from "effect";

const bytesToBase64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");

const base64UrlToBytes = (value: string) =>
  Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), (char) =>
    char.charCodeAt(0),
  );

export type TokenPayload = {
  sub: string;
  email: string;
  exp: number;
  purpose?: string;
  tenantId?: string;
  nonce?: string;
  /** Internal path to return to once a browser sign-in flow completes. */
  returnTo?: string;
  /** Serial number bound into an ADE enrollment-profile link. */
  serial?: string;
  /** ADE profile UUID the link was minted for. */
  profileUuid?: string;
  /** Session the token is bound to (step-up grants and flow bindings). */
  sid?: string;
  /** Step-up action this token authorises. */
  action?: string;
  /** Factor used to satisfy the step-up. */
  method?: string;
  /** Credential that satisfied the step-up (passkey credential id). */
  credentialId?: string;
  /** Passkey step-up flow id. */
  flowId?: string;
  /** Passkey step-up request-binding verifier. */
  verifier?: string;
  /** Hash of the emailed verification code bound into the link. */
  codeHash?: string;
  /** Absolute expiry of the passkey step-up request binding. */
  requestBindingExpiresAtMillis?: number;
  /** SSR shell snapshot (see `ssrToken.ts`); validated again by its owner. */
  name?: string;
  emailVerified?: boolean;
  /** Fingerprint of the session cookie an SSR token is bound to. */
  ch?: string;
  iat?: number;
  ver?: string;
  user?: unknown;
  tenants?: unknown;
};

export const TokenPayloadSchema = Schema.Struct({
  sub: Schema.String,
  email: Schema.String,
  exp: Schema.Number,
  purpose: Schema.optional(Schema.String),
  tenantId: Schema.optional(Schema.String),
  nonce: Schema.optional(Schema.String),
  returnTo: Schema.optional(Schema.String),
  serial: Schema.optional(Schema.String),
  profileUuid: Schema.optional(Schema.String),
  sid: Schema.optional(Schema.String),
  action: Schema.optional(Schema.String),
  method: Schema.optional(Schema.String),
  credentialId: Schema.optional(Schema.String),
  flowId: Schema.optional(Schema.String),
  verifier: Schema.optional(Schema.String),
  codeHash: Schema.optional(Schema.String),
  requestBindingExpiresAtMillis: Schema.optional(Schema.Number),
  // SSR shell snapshot. The fields stay loosely typed here so every token
  // purpose shares one primitive; `ssrToken.ts` performs the strict decode.
  name: Schema.optional(Schema.String),
  emailVerified: Schema.optional(Schema.Boolean),
  ch: Schema.optional(Schema.String),
  iat: Schema.optional(Schema.Number),
  ver: Schema.optional(Schema.String),
  user: Schema.optional(Schema.Unknown),
  tenants: Schema.optional(Schema.Unknown),
});

export const signToken = (secret: string, payload: TokenPayload) =>
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

    return Schema.decodeUnknownSync(TokenPayloadSchema)(
      JSON.parse(new TextDecoder().decode(base64UrlToBytes(body))),
    );
  });
