import { Effect, Layer } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { AzureOidc } from "@mattrax/azure-oidc";
import { Db, schema } from "@mattrax/enterprise-core";
import { signToken, verifyToken } from "@mattrax/enterprise-backend";

const json = (body: unknown, status = 200) => HttpServerResponse.jsonUnsafe(body, { status });

const id = () => crypto.randomUUID().replaceAll("-", "").slice(0, 24);
const now = () => new Date();

const redirectUri = (origin: string) => `${origin}/api/v1/sso/azure/callback`;

const safeEmail = (claims: { email?: string; preferred_username?: string; upn?: string }) =>
  (claims.email ?? claims.preferred_username ?? claims.upn ?? "").trim().toLowerCase();

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
      const db = yield* Db;
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
      const state = yield* signToken(options.authSecret!, {
        sub: tenantId,
        email: "sso-state",
        exp: Date.now() + 10 * 60 * 1000,
        nonce: crypto.randomUUID(),
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
      return json({ url: authorize.toString() });
    }).pipe(Effect.catch((error) => Effect.succeed(json({ error: String(error) }, 500))));

  const callback = (request: HttpServerRequest.HttpServerRequest) =>
    Effect.gen(function* () {
      if (!configured) return json({ error: "SSO is not configured" }, 503);
      const url = new URL(request.url, "http://localhost");
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      if (!code || !state) return json({ error: "Missing OIDC code or state" }, 400);
      const payload = yield* verifyToken(options.authSecret!, state).pipe(
        Effect.catch(() => Effect.fail(new Error("Invalid SSO state"))),
      );
      if (payload.exp <= Date.now()) return json({ error: "SSO state expired" }, 400);
      const tenantId = payload.sub;

      const db = yield* Db;
      const config = yield* db.query.ssoConfig.findFirst({
        where: { organizationId: tenantId },
      });
      if (!config?.enabled || !config.azureTenantId)
        return json({ error: "SSO is not enabled for this tenant" }, 404);

      const oidc = yield* AzureOidc;
      const discovery = yield* oidc.discovery(config.azureTenantId);
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
        catch: (cause) => new Error(`Token exchange failed: ${String(cause)}`),
      });
      if (!tokenResponse.ok)
        return json({ error: `Token exchange failed (${tokenResponse.status})` }, 502);
      const tokens = (yield* Effect.tryPromise({
        try: () => tokenResponse.json(),
        catch: () => new Error("Invalid token response"),
      })) as { id_token?: string };
      if (!tokens.id_token) return json({ error: "Identity provider returned no ID token" }, 502);

      const claims = yield* oidc
        .validateJwt(tokens.id_token, {
          tenantIds: [config.azureTenantId],
          audience: options.clientId!,
        })
        .pipe(Effect.catch(() => Effect.fail(new Error("Invalid ID token"))));
      const email = safeEmail(claims);
      if (!email) return json({ error: "Identity provider did not return an email" }, 400);

      let user = yield* db.query.user.findFirst({ where: { email } });
      if (!user) {
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
        user = yield* db.query.user.findFirst({ where: { id: userId } });
      }
      if (!user || user.disabled) return json({ error: "This account is disabled" }, 403);

      const member = yield* db.query.member.findFirst({
        where: { userId: user.id, organizationId: tenantId },
      });
      if (!member) {
        if (!config.autoProvision)
          return json({ error: "You are not a member of this tenant" }, 403);
        yield* db.insert(schema.member).values({
          id: id(),
          organizationId: tenantId,
          userId: user.id,
          role: "member",
          createdAt: now(),
          updatedAt: now(),
        });
      }

      const assertion = yield* signToken(options.authSecret!, {
        sub: user.id,
        email: user.email,
        exp: Date.now() + 2 * 60 * 1000,
        tenantId,
      });
      const location = `${options.origin}/sso/complete?token=${encodeURIComponent(assertion)}`;
      return HttpServerResponse.empty({ status: 302, headers: { location } });
    }).pipe(
      Effect.catch((error) =>
        Effect.succeed(
          json({ error: error instanceof Error ? error.message : String(error) }, 400),
        ),
      ),
    );

  return Layer.mergeAll(
    HttpRouter.add("GET", "/api/v1/sso/azure/start", start),
    HttpRouter.add("GET", "/api/v1/sso/azure/callback", callback),
  );
};
