import { Effect, Layer, Schema } from "effect";
import type { HttpServerRequest } from "effect/http";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { AzureOidc } from "@mattrax/azure-oidc";
import { Db } from "@mattrax/enterprise-core";
import { signToken, verifyToken } from "@mattrax/enterprise-tokens";
import type { SsoFailureCode } from "@mattrax/enterprise-domain";
import { loginAttemptClient, recordLoginAttempt } from "@mattrax/enterprise-backend";
import type { LoginAttemptFailure } from "@mattrax/enterprise-backend";
import { ensureCredential, exchangeSsoCode, resolveSsoAccount } from "./ssoIdentity.js";
import {
  APPLE_BYOD_STATE_PURPOSE,
  BYOD_STATE_COOKIE,
  appleByodAuthorizeRoutes,
  appleByodFailure,
  handleAppleByodSsoCallback,
} from "./appleByod.js";

const json = (body: Schema.Json, status = 200, headers?: Record<string, string>) =>
  HttpServerResponse.jsonUnsafe(body, {
    status,
    headers: { "cache-control": "no-store", ...headers },
  });

const redirectUri = (origin: string) => `${origin}/api/v1/sso/azure/callback`;

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
      const stateMatches = Boolean(
        state &&
          (request.cookies["__Host-sso_state"] === state ||
            request.cookies[BYOD_STATE_COOKIE] === state),
      );

      if (providerError)
        yield* Effect.logWarning(
          `Azure SSO provider returned an error: ${JSON.stringify(providerError.slice(0, 100))}`,
        );

      if (!code || !state) {
        // A cancelled BYOD web view returns no code but still carries the
        // signed state. Detect that purpose so the failure stays in Apple's
        // authentication session instead of redirecting to the dashboard.
        if (!code && state) {
          const possible = yield* verifyToken(options.authSecret!, state).pipe(
            Effect.catch(() => Effect.succeed(undefined)),
          );

          if (possible?.purpose === APPLE_BYOD_STATE_PURPOSE)
            return appleByodFailure(
              providerError
                ? "idp_rejected"
                : possible.exp <= Date.now()
                  ? "state_expired"
                  : "invalid_request",
              400,
              stateMatches,
            );
        }

        return yield* reject({
          code: providerError ? "idp_rejected" : "invalid_request",
          reason: "sso_rejected",
          clearState: stateMatches,
        });
      }

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

      // Apple account-driven enrollment shares this callback so deployments do
      // not need a second Entra redirect URI. The signed state names the BYOD
      // request and the browser-bound cookie check above has already passed.
      if (payload.purpose === APPLE_BYOD_STATE_PURPOSE) {
        if (payload.exp <= Date.now()) return appleByodFailure("state_expired");

        const oidc = yield* AzureOidc;

        return yield* handleAppleByodSsoCallback({
          request,
          code,
          payload,
          db,
          oidc,
          options,
        });
      }

      if (payload.exp <= Date.now())
        return yield* reject({
          code: "state_expired",
          reason: "expired",
        });

      if (payload.purpose !== "sso-state")
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
      const exchanged = yield* exchangeSsoCode({
        code,
        azureTenantId: config.azureTenantId,
        clientId: options.clientId!,
        clientSecret: options.clientSecret!,
        redirectUri: redirectUri(options.origin),
        nonce: payload.nonce ?? "",
        oidc,
      });

      if (!exchanged.ok)
        return yield* reject({
          code: exchanged.failure.code,
          reason: exchanged.failure.reason,
          accountId: exchanged.failure.accountId,
          email: exchanged.failure.email,
          returnTo,
        });

      const email = exchanged.email;
      const objectId = exchanged.objectId;

      const resolved = yield* resolveSsoAccount({
        db,
        tenantId,
        autoProvision: config.autoProvision,
        email,
        objectId,
        name: exchanged.name,
      });

      if (!resolved.ok)
        return yield* reject({
          code: resolved.failure.code,
          reason: resolved.failure.reason,
          accountId: resolved.failure.accountId,
          email: resolved.failure.email,
          returnTo,
        });

      const user = resolved.user;
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
    // Account-driven Apple enrollment's ASWebAuthenticationSession entry point.
    appleByodAuthorizeRoutes(options),
  );
};
