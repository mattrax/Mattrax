import { Effect, Schema } from "effect";

/** A token could not be encoded, verified or decoded. */
export class TokenError extends Schema.TaggedError<TokenError>()("TokenError", {
  message: Schema.String,
  reason: Schema.Literals(["malformed", "invalid_signature", "invalid_payload", "crypto"]),
  cause: Schema.optional(Schema.Defect()),
}) {}

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
  /** Apple BYOD device request bound into the BYOD SSO state token. */
  challengeId?: string;
  /** Absolute expiry of the passkey step-up request binding. */
  requestBindingExpiresAtMillis?: number;
  /** SSR shell snapshot (see `ssrToken.ts`); validated again by its owner. */
  name?: string;
  emailVerified?: boolean;
  /** Fingerprint of the session cookie an SSR token is bound to. */
  ch?: string;
  /** One-time id consumed when the token is redeemed (SSO assertions). */
  jti?: string;
  iat?: number;
  ver?: string;
  account?: unknown;
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
  challengeId: Schema.optional(Schema.String),
  requestBindingExpiresAtMillis: Schema.optional(Schema.Number),
  // SSR shell snapshot. The fields stay loosely typed here so every token
  // purpose shares one primitive; `ssrToken.ts` performs the strict decode.
  name: Schema.optional(Schema.String),
  emailVerified: Schema.optional(Schema.Boolean),
  ch: Schema.optional(Schema.String),
  jti: Schema.optional(Schema.String),
  iat: Schema.optional(Schema.Number),
  ver: Schema.optional(Schema.String),
  account: Schema.optional(Schema.Unknown),
  tenants: Schema.optional(Schema.Unknown),
});

const cryptoError = (cause: unknown) =>
  new TokenError({ message: "The token could not be processed", reason: "crypto", cause });

export const signToken = Effect.fnUntraced(function* (secret: string, payload: TokenPayload) {
  const body = yield* Effect.try({
    try: () => bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload))),
    catch: (cause) =>
      new TokenError({ message: "The token payload is invalid", reason: "invalid_payload", cause }),
  });

  const key = yield* Effect.tryPromise({
    try: () =>
      crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      ),
    catch: cryptoError,
  });

  const signature = yield* Effect.tryPromise({
    try: () => crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)),
    catch: cryptoError,
  });

  return `${body}.${bytesToBase64Url(new Uint8Array(signature))}`;
});

export const verifyToken = Effect.fnUntraced(function* (secret: string, token: string) {
  const [body, signature] = token.split(".");

  if (!body || !signature || token.includes(".") === false || token.split(".").length !== 2)
    return yield* new TokenError({ message: "Malformed token", reason: "malformed" });

  const signatureBytes = yield* Effect.try({
    try: () => base64UrlToBytes(signature),
    catch: (cause) => new TokenError({ message: "Malformed token", reason: "malformed", cause }),
  });

  const key = yield* Effect.tryPromise({
    try: () =>
      crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["verify"],
      ),
    catch: cryptoError,
  });

  const valid = yield* Effect.tryPromise({
    try: () => crypto.subtle.verify("HMAC", key, signatureBytes, new TextEncoder().encode(body)),
    catch: cryptoError,
  });

  if (!valid)
    return yield* new TokenError({
      message: "Invalid token signature",
      reason: "invalid_signature",
    });

  return yield* Effect.try({
    try: () =>
      Schema.decodeUnknownSync(TokenPayloadSchema)(
        JSON.parse(new TextDecoder().decode(base64UrlToBytes(body))),
      ),
    catch: (cause) =>
      new TokenError({ message: "Invalid token payload", reason: "invalid_payload", cause }),
  });
});
