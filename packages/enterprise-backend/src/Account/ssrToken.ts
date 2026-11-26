import { DateTime, Effect, Option, Schema } from "effect";
import {
  SSR_TOKEN_MAX_LENGTH,
  SSR_TOKEN_TTL_MILLIS,
  SsrRevisionPayload,
  SsrTokenPayload,
  ssrSessionFingerprint,
} from "@mattrax/enterprise-domain";
import type { SsrTokenTenant, SsrTokenAccount } from "@mattrax/enterprise-domain";
import { signToken, verifyToken } from "@mattrax/enterprise-tokens";

export {
  SSR_REVISION_COOKIE,
  SSR_TOKEN_COOKIE,
  SSR_TOKEN_TTL_MILLIS,
} from "@mattrax/enterprise-domain";

export type SignSsrTokenInput = {
  readonly subjectId: string;
  readonly sessionId: string;
  /** The opaque `__Host-mattrax_session` value this token is bound to. */
  readonly sessionCookie: string;
  readonly name: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly authRevision: string;
  readonly account: SsrTokenAccount;
  readonly tenants: ReadonlyArray<SsrTokenTenant>;
  readonly now?: number;
};

export type SignedSsrToken = {
  readonly token: string;
  /** Absolute milliseconds, matching the token's `exp` and the cookie's `Max-Age`. */
  readonly expiresAt: number;
  readonly includesTenants: boolean;
};

/** Read one cookie value from a raw `Cookie` header. */
export const cookieValue = (
  header: string | string[] | undefined,
  name: string,
): string | undefined => {
  const joined = Array.isArray(header) ? header.join("; ") : header;

  if (!joined) return undefined;

  for (const part of joined.split(";")) {
    const separator = part.indexOf("=");

    if (separator === -1) continue;

    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }

  return undefined;
};

/** Keep only the fields the dashboard shell reads; login data never enters the token. */
const compactTenant = (tenant: SsrTokenTenant): SsrTokenTenant => ({
  id: tenant.id,
  name: tenant.name,
  slug: tenant.slug,
  role: tenant.role,
  roleName: tenant.roleName,
  roleKind: tenant.roleKind,
  // Built-in permissions are derivable from `role` in the shared domain
  // catalogue, and an owner's 34-entry array alone is most of the cookie
  // budget. Custom roles stay explicit: their set cannot be derived.
  permissions: tenant.roleKind === "built-in" ? undefined : tenant.permissions,
  // `undefined` fields disappear during JSON encoding, so the token stays small
  // without a conditional spread.
  roleId: tenant.roleId,
  logo: tenant.logo,
  displayName: tenant.displayName,
  brandColor: tenant.brandColor,
});

/**
 * Sign the edge-verifiable SSR snapshot. No token is signed for an unverified
 * account: the web Worker ignores such a token anyway, and not minting one
 * keeps the browser from pinning a pre-verification shell for five minutes.
 *
 * If the tenant-bearing payload is over the cookie budget, no token is
 * returned. A tenant-less token would be a miss on every navigation, so the
 * browser would keep a useless `Set-Cookie` and bootstrap again each time.
 */
export const signSsrToken = (secret: string, input: SignSsrTokenInput) =>
  Effect.gen(function* () {
    if (!input.emailVerified) return undefined;

    const iat = input.now ?? DateTime.toEpochMillis(yield* DateTime.now);
    const exp = iat + SSR_TOKEN_TTL_MILLIS;

    const ch = yield* Effect.promise(() => ssrSessionFingerprint(secret, input.sessionCookie));

    const base = {
      purpose: "ssr",
      sub: input.subjectId,
      sid: input.sessionId,
      ch,
      name: input.name,
      email: input.email,
      emailVerified: input.emailVerified,
      iat,
      exp,
      // Signed for debugging but not enforced by the edge verifier; the API is
      // still the only authority on whether the session is current.
      ver: input.authRevision,
      account: input.account,
    } as const;

    const tenants = input.tenants.map(compactTenant);
    const token = yield* signToken(secret, { ...base, tenants });

    if (token.length > SSR_TOKEN_MAX_LENGTH) return undefined;

    return { token, expiresAt: exp, includesTenants: true } satisfies SignedSsrToken;
  });

const decodePayload = Schema.decodeUnknownOption(SsrTokenPayload);

export type SignSsrRevisionInput = {
  readonly sessionId: string;
  readonly authRevision: string;
  readonly now?: number;
};

export type SignedSsrRevision = {
  readonly token: string;
  readonly expiresAt: number;
};

/**
 * Sign the edge comparison value for the SSR shell. It is not a credential: it
 * carries only the session id and the account revision the API is currently
 * willing to paint. The edge requires it to match the SSR token before using a
 * warm token, so deleting or replaying one only forces bootstrap.
 */
export const signSsrRevision = (secret: string, input: SignSsrRevisionInput) =>
  Effect.gen(function* () {
    const iat = input.now ?? DateTime.toEpochMillis(yield* DateTime.now);
    const exp = iat + SSR_TOKEN_TTL_MILLIS;

    const token = yield* signToken(secret, {
      sub: input.sessionId,
      email: "",
      purpose: "ssr-rev",
      sid: input.sessionId,
      ver: input.authRevision,
      iat,
      exp,
    });

    return { token, expiresAt: exp } satisfies SignedSsrRevision;
  });

/**
 * Verify and strictly decode an SSR token. Any failure is `undefined` so a
 * tampered, expired or foreign-purpose token simply falls through to the API.
 */
export const verifySsrToken = (secret: string, token: string, now?: number) =>
  Effect.gen(function* () {
    const raw = yield* verifyToken(secret, token);
    const currentTime = now ?? DateTime.toEpochMillis(yield* DateTime.now);

    if (raw.exp <= currentTime) return yield* Effect.fail(new Error("Expired SSR token"));

    const payload = Option.getOrUndefined(decodePayload(raw));

    if (payload === undefined) return yield* Effect.fail(new Error("Invalid SSR token"));

    return payload;
  });

const decodeRevision = Schema.decodeUnknownOption(SsrRevisionPayload);

export const verifySsrRevision = (secret: string, token: string, now?: number) =>
  Effect.gen(function* () {
    const raw = yield* verifyToken(secret, token);
    const currentTime = now ?? DateTime.toEpochMillis(yield* DateTime.now);

    if (raw.exp <= currentTime) return yield* Effect.fail(new Error("Expired SSR revision"));

    const payload = Option.getOrUndefined(decodeRevision(raw));

    if (payload === undefined) return yield* Effect.fail(new Error("Invalid SSR revision"));

    return payload;
  });
