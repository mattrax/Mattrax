import { Effect, Option } from "effect";
import type { HttpServerRequest } from "effect/http";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { and, eq, gt, isNull } from "drizzle-orm";
import { Db, schema } from "@mattrax/enterprise-core";
import type { EnterpriseDb } from "@mattrax/enterprise-core";
import { signToken } from "@mattrax/enterprise-tokens";
import type { TokenPayload } from "@mattrax/enterprise-tokens";
import { loginAttemptClient, recordLoginAttempt } from "@mattrax/enterprise-backend";
import { ensureCredential, exchangeSsoCode, resolveSsoAccount } from "./ssoIdentity.js";
import type { SsoOidc } from "./ssoIdentity.js";

/**
 * Browser half of Apple account-driven User Enrollment (BYOD).
 *
 * The device opens the URL from the enrollment endpoint's WWW-Authenticate
 * header inside ASWebAuthenticationSession. Mattrax redirects that web view to
 * the tenant's existing Entra SSO, and the existing SSO callback branches here
 * when the state token names a BYOD request. The only response the device ever
 * sees at the end is a 308 to
 * apple-remotemanagement-user-login://authentication-results?access-token=...
 */

export const APPLE_BYOD_STATE_PURPOSE = "apple-byod-sso-state";

const BYOD_STATE_TTL_MILLIS = 10 * 60 * 1000;
const BYOD_TOKEN_TTL_MILLIS = 5 * 60 * 1000;

/**
 * The BYOD flow starts on the tenant hostname but Entra redirects back to the
 * deployment ORIGIN. The state cookie therefore has to be set on ORIGIN, and it
 * must not share the dashboard SSO cookie: a BYOD state in one tab would
 * otherwise evict a dashboard sign-in.
 */
export const BYOD_STATE_COOKIE = "__Host-byod_sso_state";

const STATE_COOKIE_CLEAR = `${BYOD_STATE_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

const noStore = { "cache-control": "no-store" };

const failureCopy = {
  invalid_request:
    "This enrollment link is incomplete. Return to Settings on your device and start again.",
  state_mismatch:
    "This sign-in did not start in this browser. Return to Settings on your device and start again.",
  state_expired:
    "This sign-in took too long. Return to Settings on your device and start again.",
  challenge_used:
    "This enrollment request has already been used. Return to Settings on your device and start again.",
  challenge_expired:
    "This enrollment request expired. Return to Settings on your device and start again.",
  sso_disabled:
    "Single sign-on is not enabled for this organisation. Contact your administrator.",
  enrollment_disabled:
    "Account-driven enrollment is not enabled for this organisation. Contact your administrator.",
  enrollment_not_released:
    "Account-driven enrollment has not completed real-device validation for this organisation yet.",
  sso_unavailable:
    "Single sign-on is not configured for this deployment. Contact your administrator.",
  idp_unavailable:
    "The identity provider could not be reached. Try again in a moment.",
  idp_rejected: "The identity provider rejected this sign-in.",
  unknown_account: "No Mattrax account matches the signed-in person.",
  account_disabled: "That Mattrax account is disabled. Contact your administrator.",
  not_a_member: "That account is not a member of this organisation.",
  sso_link_required:
    "This account belongs to more than one organisation and must link single sign-on in the dashboard first.",
  domain_not_verified:
    "Your email domain is not verified for this organisation. Contact your administrator.",
  provisioning_disabled:
    "No Mattrax account exists for this person and automatic provisioning is disabled.",
  account_mismatch:
    "The account you signed in with is not the Managed Apple Account you entered. Use the same address in Settings and at sign-in.",
  directory_user_missing:
    "No directory person matches this account. Ask your administrator to run directory sync, then try again.",
  sign_in_failed: "Single sign-on failed. Try again or contact your administrator.",
} satisfies Record<string, string>;

const failure = (code: string, status = 400, clearState = true) => {
  const message =
    Object.entries(failureCopy).find(([candidate]) => candidate === code)?.[1] ??
    "Enrollment could not be completed. Try again.";
  const html =
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    "<title>Enrollment could not complete</title>" +
    "<style>body{margin:0;min-height:100svh;display:flex;align-items:center;justify-content:center;background:#fafaf9;color:#1c1917;font:16px/1.5 -apple-system,BlinkMacSystemFont,system-ui,sans-serif}main{max-width:24rem;padding:2rem;text-align:center}h1{font-size:1.125rem;margin:0 0 .5rem}p{margin:0;color:#57534e}</style>" +
    "</head><body><main><h1>Enrollment could not complete</h1><p>" +
    message.replaceAll("<", "&lt;") +
    "</p></main></body></html>";

  return HttpServerResponse.text(html, {
    status,
    contentType: "text/html; charset=utf-8",
    headers: {
      ...noStore,
      // A foreign state must never expire the cookie another flow depends on.
      ...(clearState ? { "set-cookie": STATE_COOKIE_CLEAR } : {}),
    },
  });
};

/** Exported so the shared SSO callback can answer a cancelled BYOD web view. */
export const appleByodFailure = failure;

export const appleRemotemanagementRedirect = (accessToken: string) =>
  "apple-remotemanagement-user-login://authentication-results?access-token=" +
  encodeURIComponent(accessToken);

const redirect = (location: string) =>
  HttpServerResponse.empty({
    status: 308,
    headers: {
      location,
      ...noStore,
      "set-cookie": STATE_COOKIE_CLEAR,
    },
  });

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

const sha256Hex = async (value: string) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));

  return hex(new Uint8Array(digest));
};

const randomToken = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));

  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
};

/** Normalise a Managed Apple Account identifier and split off its domain. */
const parseUserIdentifier = (value: string | null | undefined) => {
  const identifier = value?.trim().toLowerCase() ?? "";
  const at = identifier.lastIndexOf("@");

  if (at <= 0 || at === identifier.length - 1) return undefined;

  const local = identifier.slice(0, at);
  const domain = identifier.slice(at + 1).replace(/\.$/, "");

  if (!/^[^\s@]+$/.test(local)) return undefined;
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(domain))
    return undefined;

  return { identifier, domain };
};

type ByodOptions = {
  readonly origin: string;
  readonly clientId?: string;
  readonly clientSecret?: string;
  readonly authSecret?: string;
};

const configured = (options: ByodOptions) =>
  Boolean(options.clientId && options.clientSecret && options.authSecret);

/** The trusted public host of the request, including proxied self-hosts. */
export const byodRequestHost = (request: {
  readonly url: string;
  readonly headers: Record<string, string | undefined>;
}) =>
  (
    request.headers["x-mattrax-public-host"]?.trim() ||
    request.headers.host?.trim() ||
    new URL(request.url, "http://localhost").host
  ).toLowerCase();

/**
 * GET /mdm/apple/byod/authorize?challenge=...&user-identifier=...
 *
 * The client appends user-identifier to the URL from WWW-Authenticate. This
 * handler validates the device request, the Managed Apple Account domain and
 * the tenant SSO configuration before redirecting to Entra.
 */
export const appleByodAuthorize = (
  request: HttpServerRequest.HttpServerRequest,
  options: ByodOptions,
) =>
  Effect.gen(function* () {
    if (!configured(options)) return failure("sso_unavailable", 503);
    const url = new URL(request.url, "http://localhost");
    const challengeId = url.searchParams.get("challenge")?.trim();
    const parsed = parseUserIdentifier(url.searchParams.get("user-identifier"));

    if (!challengeId || !parsed) return failure("invalid_request");

    // The Entra callback is registered on ORIGIN, so the state cookie must be
    // written there. A tenant-domain authorize request bounces to ORIGIN before
    // any cookie is set; ASWebAuthenticationSession follows the redirect.
    if (byodRequestHost(request) !== new URL(options.origin).host.toLowerCase()) {
      const target = new URL("/mdm/apple/byod/authorize", options.origin);
      target.searchParams.set("challenge", challengeId);
      target.searchParams.set("user-identifier", parsed.identifier);

      return HttpServerResponse.empty({
        status: 302,
        headers: { location: target.toString(), ...noStore },
      });
    }

    const db = yield* Db;
    const enrollment = yield* db.query.appleByodEnrollment.findFirst({
      where: { id: challengeId },
    });
    const now = Date.now();

    if (!enrollment) return failure("invalid_request");

    if (enrollment.challengeExpiresAt.getTime() <= now) return failure("challenge_expired");

    if (enrollment.authorizedAt || enrollment.tokenHash) return failure("challenge_used");

    const config = yield* db.query.appleByodConfig.findFirst({
      where: { organizationId: enrollment.organizationId },
    });

    if (!config?.enabled) return failure("enrollment_disabled", 403);

    if (config.hardwareValidationRequired && !config.hardwareValidatedAt)
      return failure("enrollment_not_released", 403);

    // The Managed Apple Account domain must be the exact domain published by
    // this tenant and verified in the directory. Otherwise one tenant could
    // authenticate users for another tenant's Apple domain.
    if (!config.domain || config.domain !== parsed.domain) return failure("domain_not_verified");

    const verifiedDomain = yield* db.query.ssoDomain.findFirst({
      where: {
        domain: parsed.domain,
        organizationId: enrollment.organizationId,
        isVerified: true,
      },
    });

    if (!verifiedDomain) return failure("domain_not_verified");

    const sso = yield* db.query.ssoConfig.findFirst({
      where: { organizationId: enrollment.organizationId },
    });

    if (!sso?.enabled || !sso.azureTenantId) return failure("sso_disabled");

    const nonce = crypto.randomUUID();
    const state = yield* signToken(options.authSecret!, {
      sub: enrollment.organizationId,
      email: parsed.identifier,
      exp: now + BYOD_STATE_TTL_MILLIS,
      purpose: APPLE_BYOD_STATE_PURPOSE,
      tenantId: enrollment.organizationId,
      nonce,
      challengeId: enrollment.id,
    });

    const authorize = new URL(
      "https://login.microsoftonline.com/" +
        encodeURIComponent(sso.azureTenantId) +
        "/oauth2/v2.0/authorize",
    );

    authorize.searchParams.set("client_id", options.clientId!);
    authorize.searchParams.set("response_type", "code");
    authorize.searchParams.set("response_mode", "query");
    authorize.searchParams.set(
      "redirect_uri",
      options.origin + "/api/v1/sso/azure/callback",
    );
    authorize.searchParams.set("scope", "openid profile email");
    authorize.searchParams.set("state", state);
    authorize.searchParams.set("nonce", nonce);
    authorize.searchParams.set("login_hint", parsed.identifier);
    authorize.searchParams.set("domain_hint", parsed.domain);

    return HttpServerResponse.empty({
      status: 302,
      headers: {
        location: authorize.toString(),
        ...noStore,
        "set-cookie":
          BYOD_STATE_COOKIE +
          "=" +
          encodeURIComponent(state) +
          "; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600",
      },
    });
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logError("Apple BYOD authorization failed", cause).pipe(
        Effect.as(failure("sign_in_failed", 500)),
      ),
    ),
  );

/**
 * The BYOD branch of the shared Entra callback.
 *
 * The state token has already been signature- and cookie-checked there. This
 * function completes the code exchange, enforces that the IdP identity is the
 * Managed Apple Account, proves the account and directory person share the
 * immutable IdP object id, and mints the one-time access token.
 */
export const handleAppleByodSsoCallback = (input: {
  readonly request: HttpServerRequest.HttpServerRequest;
  readonly code: string;
  readonly payload: TokenPayload;
  readonly db: EnterpriseDb;
  readonly oidc: SsoOidc;
  readonly options: ByodOptions;
}): Effect.Effect<HttpServerResponse.HttpServerResponse, never, never> =>
  Effect.gen(function* () {
    const organizationId = input.payload.tenantId;
    const challengeId = input.payload.challengeId;
    const parsed = parseUserIdentifier(input.payload.email);

    if (!organizationId || !challengeId || !parsed) return failure("invalid_request");

    const db = input.db;
    const enrollment = yield* db.query.appleByodEnrollment.findFirst({
      where: { id: challengeId, organizationId },
    });
    const now = Date.now();

    if (!enrollment) return failure("invalid_request");

    if (enrollment.challengeExpiresAt.getTime() <= now) return failure("challenge_expired");

    if (enrollment.authorizedAt || enrollment.tokenHash) return failure("challenge_used");

    const config = yield* db.query.appleByodConfig.findFirst({
      where: { organizationId },
    });

    if (!config?.enabled) return failure("enrollment_disabled", 403);

    if (config.hardwareValidationRequired && !config.hardwareValidatedAt)
      return failure("enrollment_not_released", 403);

    if (config.domain !== parsed.domain) return failure("domain_not_verified");

    const sso = yield* db.query.ssoConfig.findFirst({ where: { organizationId } });

    if (!sso?.enabled || !sso.azureTenantId) return failure("sso_disabled");

    const exchanged = yield* exchangeSsoCode({
      code: input.code,
      azureTenantId: sso.azureTenantId,
      clientId: input.options.clientId!,
      clientSecret: input.options.clientSecret!,
      redirectUri: input.options.origin + "/api/v1/sso/azure/callback",
      nonce: input.payload.nonce ?? "",
      oidc: input.oidc,
    });

    if (!exchanged.ok) {
      yield* recordFailure(input, exchanged.failure.accountId ?? null, exchanged.failure.email);
      return failure(exchanged.failure.code);
    }

    // For a federated Managed Apple Account the IdP address and the Apple
    // account are the same. Anything else needs a mapping this feature does
    // not claim to provide, so fail closed instead of enrolling the wrong
    // person under the wrong Apple ID. The immutable object id, not this
    // mutable email claim, is the person key used below.
    if (exchanged.email !== parsed.identifier) {
      yield* recordFailure(input, null, exchanged.email);
      return failure("account_mismatch", 403);
    }

    // BYOD must not create a new account or SSO link: both identities have to
    // already be linked through this exact immutable IdP object. Otherwise an
    // email-equal account could enroll a different directory person.
    const resolved = yield* resolveSsoAccount({
      db,
      tenantId: organizationId,
      autoProvision: false,
      email: exchanged.email,
      objectId: exchanged.objectId,
      name: exchanged.name,
      requireExistingIdentity: true,
    });

    if (!resolved.ok) {
      yield* recordFailure(
        input,
        resolved.failure.accountId ?? null,
        resolved.failure.email,
      );
      return failure(resolved.failure.code, 403);
    }

    const directoryUser = yield* db.query.user.findFirst({
      where: {
        organizationId,
        externalId: exchanged.objectId,
        disabled: false,
      },
    });

    if (!directoryUser) {
      yield* recordFailure(input, null, exchanged.email);
      return failure("directory_user_missing", 403);
    }

    yield* ensureCredential(db, resolved.user.id);

    const token = randomToken();
    const tokenHash = yield* Effect.tryPromise(() => sha256Hex(token)).pipe(
      Effect.catch(() => Effect.succeed("")),
    );

    if (!tokenHash) return failure("sign_in_failed", 500);

    const timestamp = new Date();
    const claimed = yield* db
      .update(schema.appleByodEnrollment)
      .set({
        managedAppleAccount: parsed.identifier,
        accountId: resolved.user.id,
        directoryUserId: directoryUser.id,
        tokenHash,
        tokenExpiresAt: new Date(timestamp.getTime() + BYOD_TOKEN_TTL_MILLIS),
        authorizedAt: timestamp,
        updatedAt: timestamp,
      })
      .where(
        and(
          eq(schema.appleByodEnrollment.id, enrollment.id),
          eq(schema.appleByodEnrollment.organizationId, organizationId),
          isNull(schema.appleByodEnrollment.authorizedAt),
          isNull(schema.appleByodEnrollment.tokenHash),
          gt(schema.appleByodEnrollment.challengeExpiresAt, timestamp),
        ),
      );

    if (claimed.affectedRows !== 1) return failure("challenge_used");

    yield* recordSuccess(input, resolved.user.id, exchanged.email);

    return redirect(appleRemotemanagementRedirect(token));
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logError("Apple BYOD SSO callback failed", cause).pipe(
        Effect.as(failure("sign_in_failed", 500)),
      ),
    ),
  );

const recordFailure = (
  input: {
    readonly request: HttpServerRequest.HttpServerRequest;
    readonly db: EnterpriseDb;
  },
  accountId: string | null,
  email: string | null | undefined,
) =>
  Effect.gen(function* () {
    if (accountId == null) return;
    const client = loginAttemptClient(
      input.request.headers,
      Option.getOrUndefined(input.request.remoteAddress) ?? null,
    );

    yield* recordLoginAttempt(input.db, {
      accountId,
      email: email ?? null,
      success: false,
      method: "sso",
      factor: "sso",
      failureReason: "sso_rejected",
      ...client,
    });
  }).pipe(Effect.catch(() => Effect.void));

const recordSuccess = (
  input: {
    readonly request: HttpServerRequest.HttpServerRequest;
    readonly db: EnterpriseDb;
  },
  accountId: string,
  email: string,
) =>
  Effect.gen(function* () {
    const client = loginAttemptClient(
      input.request.headers,
      Option.getOrUndefined(input.request.remoteAddress) ?? null,
    );

    yield* recordLoginAttempt(input.db, {
      accountId,
      email,
      success: true,
      method: "sso",
      factor: "sso",
      failureReason: null,
      ...client,
    });
  }).pipe(Effect.catch(() => Effect.void));

export const appleByodAuthorizeRoutes = (options: ByodOptions) =>
  HttpRouter.add("GET", "/mdm/apple/byod/authorize", (request) =>
    appleByodAuthorize(request, options),
  );
