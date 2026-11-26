import { Schema } from "effect";
import { builtInRolePermissions, Permission } from "./rbac.ts";

/**
 * Edge-verifiable SSR bootstrap token.
 *
 * The API Worker signs this with the deployment's `AUTH_SECRET` after a single
 * `requireUser` call, and the web Worker verifies it with WebCrypto before
 * rendering. It exists only to paint the signed-in shell and its tenant
 * affordances without a service-binding round trip; every data endpoint still
 * re-authorises the session. Nothing here grants authority on its own.
 *
 * The payload is display-only. `ver` is signed and compared with the
 * {@link SsrRevisionPayload} cookie the API mints alongside it, so a rotated
 * revision is visible at the edge; the API remains the authority on whether a
 * session is current, and every data endpoint still re-authorises.
 */
export const SSR_TOKEN_COOKIE = "__Host-mattrax_ssr";

/**
 * Signed session-revision cookie, minted with the SSR token.
 *
 * The SSR token carries `ver` (the account's `authRevision`) but the edge has
 * nothing to compare it against on its own. This cookie is that comparison
 * value: when the API rotates the revision (a passkey is removed, a session is
 * revoked, the email changes) it also clears/refreshes the revision cookie, so
 * a warm SSR token whose `ver` no longer matches stops painting the shell
 * before its five-minute TTL. It is display-only, exactly like the SSR token,
 * and bootstrap remains authoritative for every data endpoint.
 */
export const SSR_REVISION_COOKIE = "__Host-mattrax_ssr_rev";

/** Five minutes: long enough for a page and its navigations, short enough to ignore revocation lag. */
export const SSR_TOKEN_TTL_MILLIS = 5 * 60 * 1000;

export const SsrRevisionPayload = Schema.Struct({
  purpose: Schema.Literal("ssr-rev"),
  /** Session the revision belongs to; must match the SSR token's `sid`. */
  sid: Schema.String,
  /** Current `account.authRevision` when the cookie was minted. */
  ver: Schema.String,
  iat: Schema.Number,
  exp: Schema.Number,
});

export type SsrRevisionPayload = typeof SsrRevisionPayload.Type;

/**
 * The cookie is ~4/3 the size of its JSON body plus a signature. Staying under
 * 3.5 KB keeps `Set-Cookie` within the browser and proxy header limits.
 */
export const SSR_TOKEN_MAX_LENGTH = 3_500;

const NullableString = Schema.NullOr(Schema.String);

/** The subset of a membership the dashboard shell reads on first paint. */
export const SsrTokenTenant = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  slug: Schema.String,
  role: Schema.String,
  roleId: Schema.optional(NullableString),
  roleName: Schema.String,
  roleKind: Schema.Literals(["built-in", "custom"]),
  /**
   * Omitted for built-in roles: {@link ssrTenantPermissions} derives the set
   * from `role` using the catalogue both Workers already ship. Custom roles
   * always carry the explicit set because it cannot be derived.
   */
  permissions: Schema.optional(Schema.Array(Permission)),
  logo: Schema.optional(NullableString),
  displayName: Schema.optional(NullableString),
  brandColor: Schema.optional(NullableString),
});

export type SsrTokenTenant = typeof SsrTokenTenant.Type;

/**
 * Restore the permission set a token tenant may have omitted for size.
 *
 * Built-in role permissions are a pure function of the role key, so omitting
 * them costs the reader nothing and keeps an owner's 34 permissions out of the
 * cookie. A custom role always carries its explicit set; an absent set there is
 * treated as no permissions rather than falling back to the legacy base role.
 */
export const ssrTenantPermissions = (tenant: SsrTokenTenant): ReadonlyArray<Permission> =>
  tenant.permissions ??
  (tenant.roleKind === "built-in" ? [...builtInRolePermissions(tenant.role)] : []);

/** The account fields `me` exposes, duplicated here so the client can decode them. */
export const SsrTokenAccount = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  email: Schema.String,
  emailVerified: Schema.Boolean,
  image: Schema.optional(NullableString),
  mfaEnabled: Schema.Boolean,
  totpEnabled: Schema.Boolean,
  passkeyEnabled: Schema.Boolean,
  mfaRequired: Schema.Boolean,
  /** Account-level landing tenant; mirrors the `me` payload. */
  defaultTenantId: Schema.optional(NullableString),
  /** Effective platform-operator flag; mirrors the `me` payload. */
  superadmin: Schema.optional(Schema.Boolean),
});

export type SsrTokenAccount = typeof SsrTokenAccount.Type;

export const SsrTokenPayload = Schema.Struct({
  purpose: Schema.Literal("ssr"),
  sub: Schema.String,
  email: Schema.String,
  emailVerified: Schema.Boolean,
  name: Schema.String,
  sid: Schema.String,
  /** Fingerprint of the session cookie the token was minted against. */
  ch: Schema.String,
  iat: Schema.Number,
  exp: Schema.Number,
  /**
   * `account.authRevision` at issue time. The edge compares it with the signed
   * session-revision cookie; a mismatch is a miss, so a rotated revision stops
   * painting the shell before the TTL. Without that cookie the token cannot be
   * proven current, so the edge bootstraps instead of trusting it.
   */
  ver: Schema.String,
  account: SsrTokenAccount,
  /**
   * The tenant shell. The issuer never signs a token without it: a tenant-less
   * token is always a miss at the edge, so returning one would only make the
   * browser replay a cookie it can never use. A legacy in-flight token without
   * tenants is still treated as a miss by the web Worker.
   */
  tenants: Schema.optional(Schema.Array(SsrTokenTenant)),
});

export type SsrTokenPayload = typeof SsrTokenPayload.Type;

const bytesToBase64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");

/**
 * Bind a token to the opaque session cookie it was issued with. The cookie is
 * HttpOnly, so sign-out and session rotation cannot be cleaned up from script;
 * hashing the cookie into the signed payload makes the old token stop matching
 * the moment the browser's session cookie changes.
 */
export const ssrSessionFingerprint = async (secret: string, cookie: string): Promise<string> =>
  bytesToBase64Url(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(`${secret}:ssr-session:v1:${cookie}`),
      ),
    ),
  );
