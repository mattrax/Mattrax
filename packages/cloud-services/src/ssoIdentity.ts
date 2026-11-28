import { AccountId, CredentialId, MemberId, RevisionId } from "@mattrax/crypto";
import { Effect, Option, Schema } from "effect";
import { FetchHttpClient } from "effect/http";
import { and, eq } from "drizzle-orm";
import { authCredentials, schema } from "@mattrax/enterprise-core";
import type { EnterpriseDb } from "@mattrax/enterprise-core";
import { settlePendingInvitations } from "@mattrax/enterprise-identity";
import type { SsoFailureCode } from "@mattrax/enterprise-domain";
import type { LoginAttemptFailure } from "@mattrax/enterprise-backend";

const TokenResponse = Schema.Struct({ id_token: Schema.optional(Schema.String) });

export type SsoIdentityFailure = {
  readonly code: SsoFailureCode;
  readonly reason: LoginAttemptFailure;
  readonly accountId?: string | null;
  readonly email?: string | null;
};

type AccountRow = typeof schema.account.$inferSelect;

export type SsoOidc = {
  readonly discovery: (tenantId: string) => Effect.Effect<{ token_endpoint?: string }, unknown>;
  readonly validateJwt: (
    token: string,
    options: { tenantIds: ReadonlyArray<string>; audience: string },
  ) => Effect.Effect<
    {
      readonly email?: string;
      readonly preferred_username?: string;
      readonly upn?: string;
      readonly oid?: string;
      readonly sub?: string;
      readonly nonce?: string;
      readonly name?: string;
    },
    unknown
  >;
};

export const safeEmail = (claims: { email?: string; preferred_username?: string; upn?: string }) =>
  (claims.email ?? claims.preferred_username ?? claims.upn ?? "").trim().toLowerCase();

export const ensureCredential = (db: EnterpriseDb, subjectId: string) =>
  Effect.gen(function* () {
    const existing = yield* db
      .select({ credentialId: authCredentials.credentialId })
      .from(authCredentials)
      .where(and(eq(authCredentials.subjectId, subjectId), eq(authCredentials.active, true)))
      .limit(1);

    if (existing.length > 0) return;

    yield* db
      .insert(authCredentials)
      .ignore()
      .values({
        credentialId: CredentialId.make(),
        subjectId,
        revision: RevisionId.make(),
        active: true,
      });
  }).pipe(Effect.catch(() => Effect.void));

/**
 * Redeem the IdP authorization code and validate the resulting ID token.
 *
 * Shared by the normal dashboard sign-in and the Apple BYOD web-auth callback
 * so both paths enforce the same issuer, audience, nonce and email rules.
 */
export const exchangeSsoCode = (input: {
  readonly code: string;
  readonly azureTenantId: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
  readonly nonce: string;
  readonly oidc: SsoOidc;
}): Effect.Effect<
  | {
      readonly ok: true;
      readonly email: string;
      readonly objectId: string;
      readonly name?: string;
    }
  | { readonly ok: false; readonly failure: SsoIdentityFailure },
  never
> =>
  Effect.gen(function* () {
    const fail = (code: SsoFailureCode, reason: LoginAttemptFailure, email?: string) =>
      Effect.succeed({ ok: false as const, failure: { code, reason, email: email ?? null } });

    const discovery = yield* input.oidc
      .discovery(input.azureTenantId)
      .pipe(
        Effect.catch((error) =>
          Effect.logWarning("Azure SSO discovery failed", error).pipe(Effect.as(null)),
        ),
      );

    if (!discovery?.token_endpoint) return yield* fail("idp_unavailable", "sso_rejected");

    // The shared fetch port defaults to globalThis.fetch in production and can
    // be replaced with a fake layer in tests without patching the global.
    const fetch = yield* FetchHttpClient.Fetch;
    const tokenResponse = yield* Effect.tryPromise({
      try: () =>
        fetch(discovery.token_endpoint as string, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: input.clientId,
            client_secret: input.clientSecret,
            code: input.code,
            redirect_uri: input.redirectUri,
            grant_type: "authorization_code",
            scope: "openid profile email",
          }),
        }),
      catch: (cause) => cause,
    }).pipe(
      Effect.catch((error) =>
        Effect.logWarning("Azure SSO token exchange request failed", error).pipe(Effect.as(null)),
      ),
    );

    if (!tokenResponse) return yield* fail("idp_unavailable", "sso_rejected");

    if (!tokenResponse.ok) {
      yield* Effect.logWarning(
        "Azure SSO token endpoint rejected the code: HTTP " + tokenResponse.status,
      );

      return yield* fail("idp_rejected", "sso_rejected");
    }

    const rawTokens = yield* Effect.tryPromise(() => tokenResponse.json()).pipe(
      Effect.catch((error) =>
        Effect.logWarning("Azure SSO token response was not JSON", error).pipe(Effect.as(null)),
      ),
    );
    const tokens = Option.getOrUndefined(Schema.decodeUnknownOption(TokenResponse)(rawTokens));

    if (!tokens?.id_token) return yield* fail("idp_rejected", "sso_rejected");

    const claims = yield* input.oidc
      .validateJwt(tokens.id_token, {
        tenantIds: [input.azureTenantId],
        audience: input.clientId,
      })
      .pipe(Effect.catch(() => Effect.succeed(null)));

    if (!claims) yield* Effect.logWarning("Azure SSO ID token validation failed");

    if (!claims) return yield* fail("idp_rejected", "sso_rejected");

    if (claims.nonce !== input.nonce) return yield* fail("idp_rejected", "sso_rejected");

    const email = safeEmail(claims);

    if (!email) return yield* fail("unknown_account", "unknown_account");

    const objectId = claims.oid ?? claims.sub;

    if (!objectId) return yield* fail("idp_rejected", "sso_rejected", email);

    return { ok: true as const, email, objectId, name: claims.name };
  });

/**
 * Resolve the IdP identity to a Mattrax account and tenant membership.
 *
 * This is deliberately the same policy as the dashboard callback: an existing
 * multi-tenant account is never auto-linked by email, and a new account is only
 * created when the tenant allows auto-provisioning.
 */
export const resolveSsoAccount = (input: {
  readonly db: EnterpriseDb;
  readonly tenantId: string;
  readonly autoProvision: boolean;
  readonly email: string;
  readonly objectId: string;
  readonly name?: string;
  /** Fail closed unless this tenant already links the exact IdP object to an account. */
  readonly requireExistingIdentity?: boolean;
}): Effect.Effect<
  | { readonly ok: true; readonly user: AccountRow }
  | { readonly ok: false; readonly failure: SsoIdentityFailure },
  unknown
> =>
  Effect.gen(function* () {
    const db = input.db;
    const fail = (code: SsoFailureCode, reason: LoginAttemptFailure, accountId?: string | null) =>
      Effect.succeed({
        ok: false as const,
        failure: { code, reason, accountId: accountId ?? null, email: input.email },
      });

    const identity = yield* db.query.ssoIdentity.findFirst({
      where: { organizationId: input.tenantId, objectId: input.objectId },
    });

    if (!identity && input.requireExistingIdentity)
      return yield* fail("unknown_account", "unknown_account");

    let user = identity
      ? yield* db.query.account.findFirst({ where: { id: identity.accountId } })
      : yield* db.query.account.findFirst({ where: { email: input.email } });

    if (identity) {
      if (!user || user.disabled)
        return yield* fail(
          user?.disabled ? "account_disabled" : "unknown_account",
          "disabled",
          user?.id ?? null,
        );

      const member = yield* db.query.member.findFirst({
        where: { accountId: user.id, organizationId: input.tenantId },
      });

      if (!member) return yield* fail("not_a_member", "not_member", user.id);
    } else if (user) {
      // Do not auto-link an existing account by email when it belongs to
      // another tenant; that would let a tenant administrator impersonate a
      // multi-tenant user. Such users must link SSO explicitly.
      const memberships = yield* db.query.member.findMany({ where: { accountId: user.id } });
      const member = memberships.find((item) => item.organizationId === input.tenantId);

      if (!member) return yield* fail("not_a_member", "not_member", user.id);

      if (memberships.length > 1) return yield* fail("sso_link_required", "sso_rejected", user.id);

      // Only a domain the tenant has proven it controls may claim an existing
      // account by email.
      const emailDomain = input.email.slice(input.email.lastIndexOf("@") + 1).toLowerCase();

      const verifiedDomain = yield* db.query.ssoDomain.findFirst({
        where: {
          domain: emailDomain,
          organizationId: input.tenantId,
          isVerified: true,
          source: "entra",
        },
      });

      if (!verifiedDomain) return yield* fail("domain_not_verified", "sso_rejected", user.id);

      yield* db.insert(schema.ssoIdentity).ignore().values({
        organizationId: input.tenantId,
        objectId: input.objectId,
        accountId: user.id,
        createdAt: new Date(),
      });
    } else {
      if (!input.autoProvision) return yield* fail("provisioning_disabled", "unknown_account");

      const accountId = AccountId.make();
      const timestamp = new Date();
      const memberId = MemberId.make();

      yield* db.insert(schema.account).values({
        id: accountId,
        name: input.name ?? input.email,
        email: input.email,
        emailVerified: true,
        image: null,
        disabled: false,
        authRevision: RevisionId.make(),
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      yield* db.insert(schema.member).values({
        id: memberId,
        organizationId: input.tenantId,
        accountId,
        role: "member",
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      // Auto-provisioned SSO members settle a matching invitation without
      // inheriting any role the invitation offered.
      yield* settlePendingInvitations(db, input.tenantId, input.email, timestamp);
      yield* db.insert(schema.ssoIdentity).values({
        organizationId: input.tenantId,
        objectId: input.objectId,
        accountId,
        createdAt: timestamp,
      });
      user = yield* db.query.account.findFirst({ where: { id: accountId } });
    }

    if (!user || user.disabled)
      return yield* fail(
        user?.disabled ? "account_disabled" : "unknown_account",
        user ? "disabled" : "unknown_account",
        user?.id ?? null,
      );

    return { ok: true as const, user };
  });
