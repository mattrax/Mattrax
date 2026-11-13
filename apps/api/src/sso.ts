import { Effect, Layer } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { AzureOidc } from "@mattrax/azure-oidc";
import { Db, schema } from "@mattrax/enterprise-core";
import { provisionEmailCredential, signToken, verifyToken } from "@mattrax/enterprise-backend";

const json = (body: unknown, status = 200, headers?: Record<string, string>) =>
  HttpServerResponse.jsonUnsafe(body, {
    status,
    headers: { "cache-control": "no-store", ...(headers ?? {}) },
  });

const id = () => crypto.randomUUID().replaceAll("-", "").slice(0, 24);
const now = () => new Date();

const redirectUri = (origin: string) => `${origin}/api/v1/sso/azure/callback`;

const safeEmail = (claims: { email?: string; preferred_username?: string; upn?: string }) =>
  (claims.email ?? claims.preferred_username ?? claims.upn ?? "").trim().toLowerCase();

/** Only internal, absolute-path destinations can be resumed after sign-in. */
const safeReturnTo = (value: string | null | undefined) => {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return undefined;
  return value.slice(0, 2048);
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
        const user = yield* db.query.user.findFirst({ where: { email } });
        if (user) {
          const memberships = yield* db.query.member.findMany({ where: { userId: user.id } });
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
        ...(returnTo ? { returnTo } : {}),
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
      if (!configured) return json({ error: "SSO is not configured" }, 503);
      const url = new URL(request.url, "http://localhost");
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      if (!code || !state) return json({ error: "Missing OIDC code or state" }, 400);
      if (request.cookies["__Host-sso_state"] !== state)
        return json({ error: "SSO state does not match this browser" }, 400);
      const verified = yield* verifyToken(options.authSecret!, state).pipe(
        Effect.map((payload) => ({ ok: true as const, payload })),
        Effect.catchCause((cause) =>
          Effect.logWarning("Azure SSO state verification failed", cause).pipe(
            Effect.as({ ok: false as const }),
          ),
        ),
      );
      if (!verified.ok) return json({ error: "SSO state is invalid" }, 400);
      const payload = verified.payload;
      if (payload.exp <= Date.now() || payload.purpose !== "sso-state")
        return json({ error: "SSO state expired" }, 400);
      const tenantId = payload.sub;

      const db = yield* Db;
      const config = yield* db.query.ssoConfig.findFirst({
        where: { organizationId: tenantId },
      });
      if (!config?.enabled || !config.azureTenantId)
        return json({ error: "SSO is not enabled for this tenant" }, 404);

      const oidc = yield* AzureOidc;
      const discovery = yield* oidc
        .discovery(config.azureTenantId)
        .pipe(
          Effect.catchCause((cause) =>
            Effect.logError("Azure SSO discovery failed", cause).pipe(Effect.as(null)),
          ),
        );
      if (!discovery) return json({ error: "Could not contact the identity provider" }, 502);
      if (!discovery.token_endpoint)
        return json({ error: "Identity provider has no token endpoint" }, 502);

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
      if (!tokenResponse) return json({ error: "Could not contact the identity provider" }, 502);
      if (!tokenResponse.ok)
        return json({ error: "Identity provider rejected the token exchange" }, 502);
      const tokens = (yield* Effect.tryPromise({
        try: () => tokenResponse.json(),
        catch: () => null,
      })) as { id_token?: string } | null;
      if (!tokens?.id_token) return json({ error: "Identity provider returned no ID token" }, 502);

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
      if (!claims) return json({ error: "Identity provider token was rejected" }, 400);
      if (claims.nonce !== payload.nonce)
        return json({ error: "Identity provider nonce did not match" }, 400);
      const email = safeEmail(claims);
      if (!email) return json({ error: "Identity provider did not return an email" }, 400);
      const objectId = claims.oid ?? claims.sub;
      if (!objectId) return json({ error: "Identity provider did not return an object id" }, 400);

      const identity = yield* db.query.ssoIdentity.findFirst({
        where: { organizationId: tenantId!, objectId: objectId! },
      });

      let user = identity
        ? yield* db.query.user.findFirst({ where: { id: identity.userId } })
        : yield* db.query.user.findFirst({ where: { email } });

      if (identity) {
        if (!user || user.disabled) return json({ error: "This account is disabled" }, 403);
        const member = yield* db.query.member.findFirst({
          where: { userId: user.id, organizationId: tenantId },
        });
        if (!member) return json({ error: "You are not a member of this tenant" }, 403);
      } else if (user) {
        // Do not auto-link an existing account by email when it belongs to
        // another tenant; that would let a tenant administrator impersonate a
        // multi-tenant user. Such users must link SSO explicitly.
        const memberships = yield* db.query.member.findMany({ where: { userId: user.id } });
        const member = memberships.find((item) => item.organizationId === tenantId);
        if (!member) return json({ error: "You are not a member of this tenant" }, 403);
        if (memberships.length > 1)
          return json(
            { error: "This account belongs to multiple tenants; ask an administrator to link SSO" },
            403,
          );
        yield* db.insert(schema.ssoIdentity).ignore().values({
          organizationId: tenantId,
          objectId,
          userId: user.id,
          createdAt: now(),
        });
      } else {
        if (!config.autoProvision)
          return json({ error: "No Mattrax account exists for this email" }, 403);
        const userId = id();
        const timestamp = now();
        yield* db.insert(schema.user).values({
          id: userId,
          name: claims.name ?? email,
          email,
          emailVerified: true,
          image: null,
          stripeCustomerId: null,
          disabled: false,
          authRevision: id(),
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        yield* db.insert(schema.member).values({
          id: id(),
          organizationId: tenantId,
          userId,
          role: "member",
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        yield* db.insert(schema.ssoIdentity).values({
          organizationId: tenantId,
          objectId,
          userId,
          createdAt: timestamp,
        });
        user = yield* db.query.user.findFirst({ where: { id: userId } });
      }
      if (!user || user.disabled) return json({ error: "This account is disabled" }, 403);
      yield* provisionEmailCredential(db, "effect-auth/email", user.id);

      const assertion = yield* signToken(options.authSecret!, {
        sub: user.id,
        email: user.email,
        exp: Date.now() + 2 * 60 * 1000,
        purpose: "sso-assertion",
        tenantId,
      });
      const afterSignIn = safeReturnTo(payload.returnTo);
      const location = `${options.origin}/sso/complete?token=${encodeURIComponent(assertion)}${
        afterSignIn ? `&returnTo=${encodeURIComponent(afterSignIn)}` : ""
      }`;
      return HttpServerResponse.empty({
        status: 302,
        headers: {
          location,
          "cache-control": "no-store",
          "set-cookie": "__Host-sso_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
        },
      });
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logError("Azure SSO callback failed", cause).pipe(
          Effect.as(json({ error: "Could not complete SSO sign-in" }, 500)),
        ),
      ),
    );

  return Layer.mergeAll(
    HttpRouter.add("GET", "/api/v1/sso/azure/start", start),
    HttpRouter.add("GET", "/api/v1/sso/azure/callback", callback),
  );
};
