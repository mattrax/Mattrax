import {
  MeResponse,
  SSR_REVISION_COOKIE,
  SSR_TOKEN_COOKIE,
  SSR_TOKEN_TTL_MILLIS,
  ssrTenantPermissions,
} from "@mattrax/enterprise-domain/client";
import type {
  SsrRevisionPayload,
  SsrTokenPayload,
  SsrTokenTenant,
} from "@mattrax/enterprise-domain/client";
import { Option, Schema } from "effect";
import type { PreloadedSession, PreloadedSessionData } from "../lib/session-store";
import { isPassthroughPath, normalisePath } from "./security";

export const SESSION_COOKIE = "__Host-mattrax_session";

const BootstrapSession = Schema.Struct({
  sessionId: Schema.String,
  subjectId: Schema.String,
  claims: Schema.Struct({
    name: Schema.String,
    email: Schema.String,
    emailVerified: Schema.Boolean,
  }),
});

const BootstrapEnvelope = Schema.Struct({
  session: Schema.NullOr(BootstrapSession),
  me: MeResponse,
  ssrToken: Schema.NullOr(Schema.String),
  ssrTokenExpiresAt: Schema.NullOr(Schema.Number),
  // Optional during a rolling deploy: an older API does not mint a revision,
  // and the edge simply treats its token as unusable (bootstrap each time).
  ssrRevision: Schema.optional(Schema.NullOr(Schema.String)),
  ssrRevisionExpiresAt: Schema.optional(Schema.NullOr(Schema.Number)),
});

const JsonObject = Schema.Record(Schema.String, Schema.Json);

const decodeJsonObject = Schema.decodeUnknownOption(JsonObject);

export type PreloadDependencies = {
  /** Deployment `AUTH_SECRET`; without it the token path is unavailable. */
  readonly secret?: string;
  readonly verifyToken: (
    secret: string,
    token: string,
    sessionCookie: string | undefined,
    now?: number,
  ) => Promise<SsrTokenPayload | undefined>;
  readonly verifyRevision: (
    secret: string,
    token: string,
    now?: number,
  ) => Promise<SsrRevisionPayload | undefined>;
  readonly fetchBootstrap: (request: Request) => Promise<Response>;
};

export type PreloadOutcome = {
  /** `undefined` means no session information was available for this request. */
  readonly session?: PreloadedSession;
  /** A fresh `__Host-mattrax_ssr` cookie to attach to the HTML response. */
  readonly setSsrCookie?: string;
  /** The matching `__Host-mattrax_ssr_rev` cookie. */
  readonly setSsrRevisionCookie?: string;
  /** Expire a token that no longer matches a session. */
  readonly clearSsrCookie?: boolean;
  /** Expire the revision cookie alongside the token. */
  readonly clearSsrRevisionCookie?: boolean;
  /**
   * A warm token was present but did not verify. Used for a one-time operator
   * warning; the request still rendered from bootstrap.
   */
  readonly ssrTokenRejected?: boolean;
};

/** Read one cookie without decoding the rest of the header. */
export const readCookie = (header: string | null | undefined, name: string): string | undefined => {
  if (!header) return undefined;

  for (const part of header.split(";")) {
    const separator = part.indexOf("=");

    if (separator === -1) continue;

    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }

  return undefined;
};

/** `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=300` per the SSR contract. */
export const ssrSetCookie = (token: string): string =>
  `${SSR_TOKEN_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${Math.round(
    SSR_TOKEN_TTL_MILLIS / 1_000,
  )}`;

export const ssrClearCookie = (): string =>
  `${SSR_TOKEN_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;

/** Same lifetime and flags as {@link ssrSetCookie}: the pair expires together. */
export const ssrRevisionSetCookie = (token: string): string =>
  `${SSR_REVISION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${Math.round(
    SSR_TOKEN_TTL_MILLIS / 1_000,
  )}`;

export const ssrRevisionClearCookie = (): string =>
  `${SSR_REVISION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;

/**
 * Re-attach the permissions a built-in-role token omitted for size. Custom
 * roles always carry theirs; an absent set still fails closed to the role key.
 */
const restoreTenant = (tenant: SsrTokenTenant) => ({
  ...tenant,
  permissions: [...ssrTenantPermissions(tenant)],
});

/**
 * Load the signed-in session before the page renders.
 *
 * 1. A valid unexpired `__Host-mattrax_ssr` token for a verified account whose
 *    signed revision cookie names the same session and `authRevision` answers
 *    from memory: zero service-binding calls on a warm navigation.
 * 2. Otherwise one `GET /api/v1/bootstrap` (never `getSession` + `me`) supplies
 *    the session, `/me` shell and a fresh token. Bootstrap is not free: the API
 *    resolves memberships and roles per tenant, so avoid it on the hot path
 *    when a usable token exists.
 * 3. No session cookie means signed out: no call, and a stale token is expired.
 *
 * The token is display-only. Every data endpoint still re-authorises the
 * session. The 5-minute window bounds how long a stale shell can paint, and the
 * signed revision cookie normally closes that window immediately: a revoke,
 * passkey/TOTP change or email change makes the API clear the pair in the same
 * response that performed the change.
 *
 * A token minted before email verification is ignored even if the account has
 * since verified: bootstrap then returns the verified shell and a fresh token
 * instead of leaving the user on the verification screen for the token's
 * remaining lifetime.
 *
 * Any failure is a miss: the page still renders, just signed out.
 */
export async function preloadSession(
  request: Request,
  dependencies: PreloadDependencies,
  now = Date.now(),
): Promise<PreloadOutcome> {
  if (request.method !== "GET") return {};

  if (!(request.headers.get("accept") ?? "").includes("text/html")) return {};

  // `/api`, `/mdm`, `/scim`, `/mcp`, `/cdn-cgi` and `/.well-known` are owned by
  // another layer. A browser navigation (or a link preview) that sends
  // `Accept: text/html` to one of them must not trigger a bootstrap call or a
  // `Set-Cookie`; the owning handler answers it.
  if (isPassthroughPath(normalisePath(new URL(request.url).pathname))) return {};

  const cookieHeader = request.headers.get("cookie");
  const sessionCookie = readCookie(cookieHeader, SESSION_COOKIE);
  const ssrCookie = readCookie(cookieHeader, SSR_TOKEN_COOKIE);
  const ssrRevisionCookie = readCookie(cookieHeader, SSR_REVISION_COOKIE);

  if (!sessionCookie) {
    // Signed out. Expire any token left behind by a sign-out or rotation so it
    // can never paint a stale shell on a later navigation.
    return ssrCookie !== undefined || ssrRevisionCookie !== undefined
      ? { session: null, clearSsrCookie: true, clearSsrRevisionCookie: true }
      : {};
  }

  let tokenRejected = false;

  if (ssrCookie && dependencies.secret) {
    const payload = await dependencies.verifyToken(
      dependencies.secret,
      ssrCookie,
      sessionCookie,
      now,
    );

    const revision = ssrRevisionCookie
      ? await dependencies.verifyRevision(dependencies.secret, ssrRevisionCookie, now)
      : undefined;

    // A token without tenants was over budget at issue time (or came from a
    // legacy issuer); treat it as a miss so the shell still gets the full
    // membership list. An unverified account must also bootstrap so a
    // just-verified user is not pinned to the verification screen by a token
    // minted before verification. Finally, `ver` is only trustworthy when the
    // signed revision cookie names the same session and revision: a missing,
    // expired, tampered or rotated revision is a miss, never a pass.
    // A token minted before the account joined this tenant would paint a
    // shell without it (and the tenant switcher would lie) for the rest of its
    // five-minute window. A tenant-scoped navigation that is not in the signed
    // membership list is therefore a miss; bootstrap has the current list.
    const tenantInPath = /^\/t\/([^/]+)/.exec(new URL(request.url).pathname)?.[1];

    if (
      payload?.tenants &&
      payload.user.emailVerified &&
      revision !== undefined &&
      revision.sid === payload.sid &&
      revision.ver === payload.ver &&
      (tenantInPath === undefined ||
        payload.tenants.some(
          (tenant) => tenant.id === tenantInPath || tenant.slug === tenantInPath,
        ))
    ) {
      return {
        session: {
          sessionId: payload.sid,
          subjectId: payload.sub,
          claims: {
            name: payload.name,
            email: payload.email,
            emailVerified: payload.emailVerified,
          },
          me: { user: payload.user, tenants: payload.tenants.map(restoreTenant) },
        } satisfies PreloadedSessionData,
      };
    }

    // A revision mismatch is not a secret misconfiguration; only a token that
    // failed its own signature/replay checks deserves the operator warning.
    tokenRejected = payload === undefined;
  }

  const withTokenRejection = (outcome: PreloadOutcome): PreloadOutcome =>
    tokenRejected ? { ...outcome, ssrTokenRejected: true } : outcome;

  try {
    const response = await dependencies.fetchBootstrap(request);

    if (!response.ok) return {};

    const data = Option.getOrUndefined(
      Schema.decodeUnknownOption(BootstrapEnvelope)(await response.json()),
    );

    if (data === undefined) return {};

    if (data.session === null) {
      const hadShellCookies = ssrCookie !== undefined || ssrRevisionCookie !== undefined;

      return withTokenRejection({
        session: null,
        clearSsrCookie: hadShellCookies,
        clearSsrRevisionCookie: hadShellCookies,
      });
    }

    const session = { ...data.session, me: data.me };

    // Without the shared secret a token could never be verified, so do not set
    // a cookie the next request would simply ignore.
    if (data.ssrToken && dependencies.secret) {
      // Verify the pair we are about to store. A token without tenants (from
      // an older issuer during a deploy) or one signed with a different secret
      // would be a miss on every navigation, and the browser would keep a
      // useless Set-Cookie while the API re-signs it each time. The revision
      // must name the same session and revision as the token.
      const fresh = await dependencies.verifyToken(
        dependencies.secret,
        data.ssrToken,
        sessionCookie,
        now,
      );

      const freshRevision = data.ssrRevision
        ? await dependencies.verifyRevision(dependencies.secret, data.ssrRevision, now)
        : undefined;

      if (fresh === undefined) tokenRejected = true;
      else if (
        fresh.tenants &&
        data.ssrRevision &&
        freshRevision !== undefined &&
        freshRevision.sid === fresh.sid &&
        freshRevision.ver === fresh.ver
      )
        return withTokenRejection({
          session,
          setSsrCookie: ssrSetCookie(data.ssrToken),
          setSsrRevisionCookie: ssrRevisionSetCookie(data.ssrRevision),
        });
    }

    return withTokenRejection({ session });
  } catch {
    // A slow or unavailable API must not hold or break the document.
    return {};
  }
}

const bootstrapRedactionHeaders = (): Headers => {
  const headers = new Headers();

  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  headers.set("vary", "cookie");

  return headers;
};

/**
 * A body that cannot be decoded cannot be proven token-free. Fail closed rather
 * than forwarding an unredacted bootstrap response to the browser.
 */
const unreadableBootstrapResponse = (): Response =>
  Response.json(
    { error: "bootstrap_response_unreadable" },
    { status: 502, headers: bootstrapRedactionHeaders() },
  );

/**
 * Remove the SSR token from a browser-visible bootstrap response. The token is
 * a service-binding artefact: the web Worker consumes it directly and it must
 * never reach a page request that came through `/api/*`.
 */
export async function redactBootstrapResponse(response: Response): Promise<Response> {
  if (response.status !== 200 || !(response.headers.get("content-type") ?? "").includes("json"))
    return response;

  try {
    const body = Option.getOrUndefined(decodeJsonObject(await response.clone().json()));

    if (body === undefined) return unreadableBootstrapResponse();

    if (
      !("ssrToken" in body) &&
      !("ssrTokenExpiresAt" in body) &&
      !("ssrRevision" in body) &&
      !("ssrRevisionExpiresAt" in body)
    )
      return response;

    const headers = new Headers(response.headers);

    // The body is re-serialised, so validators that describe the original bytes
    // (and any content encoding) can no longer be trusted by a cache.
    headers.delete("content-length");
    headers.delete("content-encoding");
    headers.delete("etag");
    headers.delete("last-modified");
    headers.set("cache-control", "no-store");
    headers.set("vary", "cookie");

    return Response.json(
      {
        ...body,
        ssrToken: null,
        ssrTokenExpiresAt: null,
        ssrRevision: null,
        ssrRevisionExpiresAt: null,
      },
      { status: response.status, headers },
    );
  } catch {
    return unreadableBootstrapResponse();
  }
}
