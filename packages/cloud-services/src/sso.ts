import { Effect, Layer, Option, Schema } from "effect";
import type { HttpServerRequest } from "effect/http";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { and, eq } from "drizzle-orm";
import { AzureOidc } from "@mattrax/azure-oidc";
import { Db, authCredentials, schema } from "@mattrax/enterprise-core";
import type { EnterpriseDb } from "@mattrax/enterprise-core";
import { settlePendingInvitations } from "@mattrax/enterprise-identity";
import { signToken, verifyToken } from "@mattrax/enterprise-tokens";
import type { SsoFailureCode } from "@mattrax/enterprise-domain";
import { loginAttemptClient, recordLoginAttempt } from "@mattrax/enterprise-backend";
import type { LoginAttemptFailure } from "@mattrax/enterprise-backend";

const TokenResponse = Schema.Struct({ id_token: Schema.optional(Schema.String) });

const json = (body: Schema.Json, status = 200, headers?: Record<string, string>) =>
  HttpServerResponse.jsonUnsafe(body, {
    status,
    headers: { "cache-control": "no-store", ...headers },
  });

const id = () => crypto.randomUUID().replaceAll("-", "").slice(0, 24);

const now = () => new Date();

/**
 * SSO assertions reference a credential in the shared auth authority. Accounts
 * created by directory sync may not have a passkey yet, so make sure the
 * subject has one stable authority row. This row is not a sign-in method: the
 * SSO strategy owns the assertion and the session requirement decides access.
 */
const ensureCredential = (db: EnterpriseDb, subjectId: string) =>
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
      .values({ credentialId: id(), subjectId, revision: id(), active: true });
  }).pipe(Effect.catch(() => Effect.void));

const redirectUri = (origin: string) => `${origin}/api/v1/sso/azure/callback`;

const safeEmail = (claims: { email?: string; preferred_username?: string; upn?: string }) =>
  (claims.email ?? claims.preferred_username ?? claims.upn ?? "").trim().toLowerCase();

/** Only internal, absolute-path destinations can be resumed after sign-in. */
const safeReturnTo = (value: string | null | undefined) => {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\"))
    return undefined;

  return value.slice(0, 2048);
};

const SSO_STATE_COOKIE_CLEAR =
  "__Host-sso_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0";

/** The completion page owns the user-facing copy for a failure code. */
const completionFailure = (
  origin: string,
  code: SsoFailureCode,
  returnTo?: string | null,
  clearState = true,
) => {
  const params = new URLSearchParams({ error: code });
  const afterSignIn = safeReturnTo(returnTo);

  if (afterSignIn) params.set("returnTo", afterSignIn);

  return HttpServerResponse.empty({
    status: 302,
    headers: {
      location: `${origin}/sso/complete?${params}`,
      "cache-control": "no-store",
      // Only the flow that owns the cookie may expire it. A callback from a
      // second tab that presents a different state must leave the first tab's
      // in-flight sign-in intact.
      ...(clearState ? { "set-cookie": SSO_STATE_COOKIE_CLEAR } : {}),
    },
  });
};

export type SsoRoutesOptions = {
  readonly origin: string;
  readonly clientId?: string;
  readonly clientSecret?: string;
  readonly authSecret?: string;
};

export const ssoRoutes = (options: SsoRoutesOptions) => {
  const configured = Boolean(options.clientId && options.clientSecret && options.authSecret);

  const start = (request: HttpServerRequest.HttpServerRequest) =>
    Effect.gen(function* () {
      if (!configured) return json({ error: "SSO is not configured" }, 503);
      const url = new URL(request.url, "http://localhost");
      let tenantId = url.searchParams.get("tenantId");
      const email = url.searchParams.get("email")?.trim().toLowerCase();
      const returnTo = safeReturnTo(url.searchParams.get("returnTo"));
      const db = yield* Db;
      const emailDomain = email?.slice(email.lastIndexOf("@") + 1).toLowerCase();

      if (!tenantId && emailDomain) {
        // Verified Entra domains route users before they have a Mattrax
        // account. Never route on an unverified/manual domain.
        const mapping = yield* db.query.ssoDomain.findFirst({
          where: { domain: emailDomain, isVerified: true, source: "entra" },
        });

        if (mapping) tenantId = mapping.organizationId;
      }

      if (!tenantId && email) {
        const user = yield* db.query.account.findFirst({ where: { email } });

        if (user) {
          const memberships = yield* db.query.member.findMany({ where: { accountId: user.id } });

          for (const membership of memberships) {
            const candidate = yield* db.query.ssoConfig.findFirst({
              where: { organizationId: membership.organizationId, enabled: true },
            });

            if (candidate?.azureTenantId) {
              tenantId = membership.organizationId;
              break;
            }
          }
        }
      }

      if (!tenantId) return json({ error: "No SSO tenant found for this email" }, 404);

      const config = yield* db.query.ssoConfig.findFirst({
        where: { organizationId: tenantId },
      });

      if (!config?.enabled || !config.azureTenantId)
        return json({ error: "SSO is not enabled for this tenant" }, 404);

      // The sign-in screen names the organisation so users can recognise the
      // account before leaving Mattrax.
      const organization = yield* db.query.organization.findFirst({
        where: { id: tenantId },
      });

      const organizationName = organization?.name ?? null;

      // Discovery is read-only: it must not mint a state token or overwrite
      // the cookie that a redirect already in flight depends on.
      if (url.searchParams.get("discover") === "1")
        return json({
          available: true,
          organization: organizationName ? { name: organizationName } : null,
        });
      const nonce = crypto.randomUUID();

      const state = yield* signToken(options.authSecret!, {
        sub: tenantId,
        email: "sso-state",
        exp: Date.now() + 10 * 60 * 1000,
        purpose: "sso-state",
        nonce,
        returnTo,
      });

      const authorize = new URL(
        `https://login.microsoftonline.com/${encodeURIComponent(config.azureTenantId)}/oauth2/v2.0/authorize`,
      );

      authorize.searchParams.set("client_id", options.clientId!);
      authorize.searchParams.set("response_type", "code");
      authorize.searchParams.set("response_mode", "query");
      authorize.searchParams.set("redirect_uri", redirectUri(options.origin));
      authorize.searchParams.set("scope", "openid profile email");
      authorize.searchParams.set("state", state);
      authorize.searchParams.set("nonce", nonce);

      if (email) authorize.searchParams.set("login_hint", email);

      if (emailDomain) authorize.searchParams.set("domain_hint", emailDomain);

      return json(
        {
          url: authorize.toString(),
          organization: organizationName ? { name: organizationName } : null,
        },
        200,
        {
          "set-cookie": `__Host-sso_state=${encodeURIComponent(state)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
        },
      );
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logError("Azure SSO start failed", cause).pipe(
          Effect.as(json({ error: "Could not start SSO sign-in" }, 500)),
        ),
      ),
    );

  const callback = (request: HttpServerRequest.HttpServerRequest) =>
    Effect.gen(function* () {
      if (!configured) return completionFailure(options.origin, "sso_unavailable");
      const url = new URL(request.url, "http://localhost");
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const db = yield* Db;

      /**
       * The identity provider is outside Mattrax, so a rejection after the
       * callback resolved the account is a failed sign-in that account should
       * see. Rejections before that point (missing code/state, cookie mismatch,
       * invalid assertion) have no owner and are not stored: the log is only
       * readable through an account-scoped API.
       *
       * Every failure is a redirect to the styled completion page. The URL
       * carries only a stable code; the reason, email and IdP detail stay in
       * the server-side attempt log.
       */
      const reject = (input: {
        code: SsoFailureCode;
        reason: LoginAttemptFailure;
        accountId?: string | null;
        email?: string | null;
        returnTo?: string | null;
        /**
         * False when the presented state did not come from this browser: that
         * cookie belongs to another tab's flow and must not be expired.
         */
        clearState?: boolean;
      }) =>
        Effect.gen(function* () {
          const response = completionFailure(
            options.origin,
            input.code,
            input.returnTo,
            input.clearState ?? true,
          );

          if (input.accountId == null) return response;

          const client = loginAttemptClient(
            request.headers,
            Option.getOrUndefined(request.remoteAddress) ?? null,
          );

          yield* recordLoginAttempt(db, {
            accountId: input.accountId,
            email: input.email ?? null,
            success: false,
            method: "sso",
            factor: "sso",
            failureReason: input.reason,
            ...client,
          });

          return response;
        });

      // Entra answers a denied consent or a failed policy with `error` instead
      // of a code. Log the provider codes, never their description.
      const providerError = url.searchParams.get("error");
      // The cookie identifies the browser flow that started this sign-in. Only
      // a callback presenting that same state may expire it; otherwise a second
      // tab would wipe the state the first tab still needs.
      const stateMatches = Boolean(state && request.cookies["__Host-sso_state"] === state);

      if (providerError)
        yield* Effect.logWarning(
          `Azure SSO provider returned an error: ${JSON.stringify(providerError.slice(0, 100))}`,
        );

      if (!code || !state)
        return yield* reject({
          code: providerError ? "idp_rejected" : "invalid_request",
          reason: "sso_rejected",
          clearState: stateMatches,
        });

      if (!stateMatches)
        return yield* reject({
          code: "state_mismatch",
          reason: "sso_rejected",
          clearState: false,
        });

      const verified = yield* verifyToken(options.authSecret!, state).pipe(
        Effect.map((payload) => ({ ok: true as const, payload })),
        Effect.catchCause((cause) =>
          Effect.logWarning("Azure SSO state verification failed", cause).pipe(
            Effect.as({ ok: false as const }),
          ),
        ),
      );

      if (!verified.ok)
        return yield* reject({
          code: "state_mismatch",
          reason: "sso_rejected",
        });
      const payload = verified.payload;

      if (payload.exp <= Date.now() || payload.purpose !== "sso-state")
        return yield* reject({
          code: "state_expired",
          reason: "expired",
        });
      const tenantId = payload.sub;
      const returnTo = safeReturnTo(payload.returnTo);

      const config = yield* db.query.ssoConfig.findFirst({
        where: { organizationId: tenantId },
      });

      if (!config?.enabled || !config.azureTenantId)
        return yield* reject({
          code: "sso_disabled",
          reason: "sso_rejected",
          returnTo,
        });

      const oidc = yield* AzureOidc;

      const discovery = yield* oidc
        .discovery(config.azureTenantId)
        .pipe(
          Effect.catchCause((cause) =>
            Effect.logError("Azure SSO discovery failed", cause).pipe(Effect.as(null)),
          ),
        );

      if (!discovery)
        return yield* reject({
          code: "idp_unavailable",
          reason: "sso_rejected",
          returnTo,
        });

      if (!discovery.token_endpoint)
        return yield* reject({
          code: "idp_unavailable",
          reason: "sso_rejected",
          returnTo,
        });

      const tokenResponse = yield* Effect.tryPromise({
        try: () =>
          fetch(discovery.token_endpoint!, {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              client_id: options.clientId!,
              client_secret: options.clientSecret!,
              code,
              redirect_uri: redirectUri(options.origin),
              grant_type: "authorization_code",
              scope: "openid profile email",
            }),
          }),
        catch: (cause) => cause,
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logError("Azure SSO token exchange request failed", cause).pipe(Effect.as(null)),
        ),
      );

      if (!tokenResponse)
        return yield* reject({
          code: "idp_unavailable",
          reason: "sso_rejected",
          returnTo,
        });

      if (!tokenResponse.ok)
        return yield* reject({
          code: "idp_rejected",
          reason: "sso_rejected",
          returnTo,
        });

      const rawTokens = yield* Effect.tryPromise({
        try: () => tokenResponse.json(),
        catch: () => null,
      });

      const tokens = Option.getOrUndefined(Schema.decodeUnknownOption(TokenResponse)(rawTokens));

      if (!tokens?.id_token)
        return yield* reject({
          code: "idp_rejected",
          reason: "sso_rejected",
          returnTo,
        });

      const claims = yield* oidc
        .validateJwt(tokens.id_token, {
          tenantIds: [config.azureTenantId],
          audience: options.clientId!,
        })
        .pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("Azure SSO ID token validation failed", cause).pipe(Effect.as(null)),
          ),
        );

      if (!claims)
        return yield* reject({
          code: "idp_rejected",
          reason: "sso_rejected",
          returnTo,
        });

      if (claims.nonce !== payload.nonce)
        return yield* reject({
          code: "idp_rejected",
          reason: "sso_rejected",
          returnTo,
        });
      const email = safeEmail(claims);

      if (!email)
        return yield* reject({
          code: "unknown_account",
          reason: "unknown_account",
          returnTo,
        });
      const objectId = claims.oid ?? claims.sub;

      if (!objectId)
        return yield* reject({
          code: "idp_rejected",
          reason: "sso_rejected",
          email,
          returnTo,
        });

      const identity = yield* db.query.ssoIdentity.findFirst({
        where: { organizationId: tenantId, objectId },
      });

      let user = identity
        ? yield* db.query.account.findFirst({ where: { id: identity.accountId } })
        : yield* db.query.account.findFirst({ where: { email } });

      if (identity) {
        if (!user || user.disabled)
          return yield* reject({
            code: user?.disabled ? "account_disabled" : "unknown_account",
            reason: "disabled",
            accountId: user?.id ?? null,
            email,
            returnTo,
          });

        const member = yield* db.query.member.findFirst({
          where: { accountId: user.id, organizationId: tenantId },
        });

        if (!member)
          return yield* reject({
            code: "not_a_member",
            reason: "not_member",
            accountId: user.id,
            email,
            returnTo,
          });
      } else if (user) {
        // Do not auto-link an existing account by email when it belongs to
        // another tenant; that would let a tenant administrator impersonate a
        // multi-tenant user. Such users must link SSO explicitly.
        const memberships = yield* db.query.member.findMany({ where: { accountId: user.id } });
        const member = memberships.find((item) => item.organizationId === tenantId);

        if (!member)
          return yield* reject({
            code: "not_a_member",
            reason: "not_member",
            accountId: user.id,
            email,
            returnTo,
          });

        if (memberships.length > 1)
          return yield* reject({
            code: "sso_link_required",
            reason: "sso_rejected",
            accountId: user.id,
            email,
            returnTo,
          });

        // Only a domain the tenant has proven it controls may claim an
        // existing account by email. Otherwise an administrator could link an
        // Entra tenant they own and sign in as an owner of this tenant.
        const emailDomain = email.slice(email.lastIndexOf("@") + 1).toLowerCase();

        const verifiedDomain = yield* db.query.ssoDomain.findFirst({
          where: {
            domain: emailDomain,
            organizationId: tenantId,
            isVerified: true,
            source: "entra",
          },
        });

        if (!verifiedDomain)
          return yield* reject({
            code: "domain_not_verified",
            reason: "sso_rejected",
            accountId: user.id,
            email,
            returnTo,
          });

        yield* db.insert(schema.ssoIdentity).ignore().values({
          organizationId: tenantId,
          objectId,
          accountId: user.id,
          createdAt: now(),
        });
      } else {
        if (!config.autoProvision)
          return yield* reject({
            code: "provisioning_disabled",
            reason: "unknown_account",
            email,
            returnTo,
          });
        const accountId = id();
        const timestamp = now();
        yield* db.insert(schema.account).values({
          id: accountId,
          name: claims.name ?? email,
          email,
          emailVerified: true,
          image: null,
          disabled: false,
          authRevision: id(),
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        yield* db.insert(schema.member).values({
          id: id(),
          organizationId: tenantId,
          accountId,
          role: "member",
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        // Auto-provisioned SSO members settle a matching invitation without
        // inheriting any role the invitation offered.
        yield* settlePendingInvitations(db, tenantId, email, timestamp);
        yield* db.insert(schema.ssoIdentity).values({
          organizationId: tenantId,
          objectId,
          accountId,
          createdAt: timestamp,
        });
        user = yield* db.query.account.findFirst({ where: { id: accountId } });
      }

      if (!user || user.disabled)
        return yield* reject({
          code: user?.disabled ? "account_disabled" : "unknown_account",
          reason: user ? "disabled" : "unknown_account",
          accountId: user?.id ?? null,
          email,
          returnTo,
        });
      yield* ensureCredential(db, user.id);

      const assertion = yield* signToken(options.authSecret!, {
        sub: user.id,
        email: user.email,
        exp: Date.now() + 2 * 60 * 1000,
        purpose: "sso-assertion",
        tenantId,
        jti: crypto.randomUUID(),
      });

      const location = `${options.origin}/sso/complete?token=${encodeURIComponent(assertion)}${
        returnTo ? `&returnTo=${encodeURIComponent(returnTo)}` : ""
      }`;

      return HttpServerResponse.empty({
        status: 302,
        headers: {
          location,
          "cache-control": "no-store",
          "set-cookie": SSO_STATE_COOKIE_CLEAR,
        },
      });
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logError("Azure SSO callback failed", cause).pipe(
          // A defect or an unhandled service failure still lands on the styled
          // page; the cause stays in the server log.
          Effect.as(completionFailure(options.origin, "sign_in_failed")),
        ),
      ),
    );

  return Layer.mergeAll(
    HttpRouter.add("GET", "/api/v1/sso/azure/start", start),
    HttpRouter.add("GET", "/api/v1/sso/azure/callback", callback),
  );
};
