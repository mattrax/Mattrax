import { fetchApi } from "./api";
import { getBindings } from "./bindings";
import type { StartMiddleware } from "@solidjs/vite-plugin";
import type { Schema } from "effect";
import { createAPIHandler } from "filesystem-routing/api";
import routes from "virtual:file-routes";
import { getPreloadedSession, setPreloadedSession } from "~/lib/session-store";
import { setRegistrationNonce } from "~/lib/registration-nonce";
import { newRegistrationNonce, registrationNonceCookie } from "@mattrax/enterprise-domain/client";
import { isCacheablePublicPage } from "~/lib/public-routes";
import { SESSION_PRESENCE_MAX_AGE_SECONDS, sessionPresenceSetCookie } from "~/lib/session-presence";
import { postHogEnvironment, setPostHogConfig } from "~/lib/posthog-config-store";
import { setSupportConfig } from "~/lib/support-config-store";
import { DEPLOYMENT_ID } from "~/lib/deployment";
import {
  expireSsrToken,
  preloadSession,
  redactBootstrapResponse,
  ssrClearCookie,
  ssrRevisionClearCookie,
} from "./preload";
import { isBootstrapPath, isProfileUpdatePath, normalisePath } from "./security";
import { verifySsrRevision, verifySsrToken } from "./ssr-token";

const api = createAPIHandler(routes);

// Per-isolate one-shot reports. The SSR token is an optimisation: with a
// missing or mismatched secret the page still renders from bootstrap, but every
// navigation pays the API round trip. `console.error` makes Workers Issues
// group the misconfiguration instead of hiding it among warnings.
let reportedMissingAuthSecret = false;

let reportedMissingPostHogKey = false;

let reportedSsrTokenRejected = false;

const reportMissingPostHogKey = (): void => {
  if (reportedMissingPostHogKey) return;

  reportedMissingPostHogKey = true;
  console.warn(
    "[posthog] POSTHOG_KEY is not configured on the mattrax Worker; browser analytics is disabled. Set it with `cf workers secrets put POSTHOG_KEY --worker mattrax`.",
  );
};

const reportMissingAuthSecret = (): void => {
  if (reportedMissingAuthSecret) return;

  reportedMissingAuthSecret = true;
  console.error(
    "[ssr] AUTH_SECRET is not configured on the mattrax Worker; SSR tokens cannot be verified, so every authenticated page render calls bootstrap. Set the same AUTH_SECRET on mattrax and mattrax-api.",
  );
};

const reportSsrTokenRejected = (): void => {
  if (reportedSsrTokenRejected) return;

  reportedSsrTokenRejected = true;
  console.error(
    "[ssr] A bootstrap token failed edge verification; falling back to bootstrap. mattrax and mattrax-api must share the same AUTH_SECRET. The secret itself is never logged.",
  );
};

/**
 * Ask the API for the session, `/me` shell and a fresh SSR token in one call.
 * The request's cookies travel with it; the caller's IP is forwarded when the
 * edge exposed it so the API's own rate limiting sees the real client.
 */
async function fetchBootstrap(request: Request): Promise<Response> {
  const url = new URL(request.url);

  const headers = new Headers({
    "content-type": "application/json",
    origin: url.origin,
  });

  const cookie = request.headers.get("cookie");
  const ip = request.headers.get("cf-connecting-ip");

  if (cookie) headers.set("cookie", cookie);

  if (ip) headers.set("cf-connecting-ip", ip);

  return fetchApi(
    new Request(new URL("/api/v1/bootstrap", url), {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(2_000),
    }),
  );
}

const isHtml = (response: Response): boolean =>
  (response.headers.get("content-type") ?? "").includes("text/html");

/**
 * Server middleware for the file-based HTTP routes.
 *
 * `/api/*`, `/mdm/*` and `/scim/*` proxy to the API Worker over its `API`
 * service binding. In production those paths are Workers routes on this host
 * and reach the API directly; the routes here keep local development,
 * previews and self-hosted deployments working. Every other request falls
 * through to the page render.
 */
const oauthMetadata = (url: URL): Response | undefined => {
  const origin = url.origin;

  const json = (body: Schema.Json) =>
    Response.json(body, {
      headers: {
        "cache-control": "no-store",
        "access-control-allow-origin": "*",
      },
    });

  if (
    url.pathname === "/.well-known/oauth-protected-resource" ||
    url.pathname === "/.well-known/oauth-protected-resource/mcp"
  )
    return json({
      resource: `${origin}/mcp`,
      authorization_servers: [origin],
      bearer_methods_supported: ["header"],
      scopes_supported: ["mcp"],
      resource_name: "Mattrax MCP",
      resource_documentation: `${origin}/docs/`,
    });

  if (
    url.pathname === "/.well-known/oauth-authorization-server" ||
    url.pathname === "/.well-known/oauth-authorization-server/api/mcp"
  )
    return json({
      issuer: origin,
      authorization_endpoint: `${origin}/api/oauth/authorize`,
      token_endpoint: `${origin}/api/oauth/token`,
      registration_endpoint: `${origin}/api/oauth/register`,
      revocation_endpoint: `${origin}/api/oauth/revoke`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: ["mcp"],
      service_documentation: `${origin}/docs/`,
    });

  return undefined;
};

const middleware: StartMiddleware = async (event, next) => {
  const requestUrl = new URL(event.request.url);

  // Apple's account-driven enrollment discovery document belongs to the API:
  // only it can resolve the tenant by host and read the BYOD configuration.
  if (requestUrl.pathname === "/.well-known/com.apple.remotemanagement")
    return fetchApi(event.request);

  const metadata = oauthMetadata(requestUrl);

  if (metadata) return metadata;

  // Deployment bindings: secrets and plain-text configuration, plus the API
  // client. Resolved per isolate; the shape is the same on Cloudflare and Node.
  const bindings = getBindings();
  const posthogKey = bindings.POSTHOG_KEY?.trim();

  setSupportConfig(event.request, { url: bindings.SUPPORT_URL?.trim() ?? "" });

  if (posthogKey)
    setPostHogConfig(event.request, {
      key: posthogKey,
      host: bindings.POSTHOG_HOST?.trim() || "https://us.i.posthog.com",
      environment: postHogEnvironment(new URL(event.request.url).hostname),
      release: DEPLOYMENT_ID,
      deploymentId: DEPLOYMENT_ID,
    });
  else reportMissingPostHogKey();

  if (!bindings.AUTH_SECRET) reportMissingAuthSecret();

  // Landing and legal pages have a signed-out, cacheable shell. Skipping the
  // preload makes them zero service-binding calls and keeps personal data out
  // of the CDN copy; the client loads the session after hydration.
  const requestPath = normalisePath(new URL(event.request.url).pathname);

  const publicPage =
    (event.request.method === "GET" || event.request.method === "HEAD") &&
    isCacheablePublicPage(requestPath);

  // Sign-up pages carry an Email Verification API nonce. It is minted here so
  // the server-rendered hidden input and the cookie the API checks agree on
  // the first frame; `/login` gets one too because the router can reach the
  // sign-up form client-side without another document request. A fresh form
  // load therefore always rotates the nonce.
  const registrationNonce =
    event.request.method === "GET" &&
    !publicPage &&
    (requestPath === "/register" || requestPath === "/login")
      ? newRegistrationNonce()
      : undefined;

  if (registrationNonce !== undefined) setRegistrationNonce(event.request, registrationNonce);

  const outcome = publicPage
    ? {}
    : await preloadSession(event.request, {
        secret: bindings.AUTH_SECRET,
        verifyToken: verifySsrToken,
        verifyRevision: verifySsrRevision,
        fetchBootstrap,
      });

  if (outcome.ssrTokenRejected) reportSsrTokenRejected();

  if (outcome.session !== undefined) setPreloadedSession(event.request, outcome.session);

  // Canonical tenant URLs: an id link from a bookmark or an older integration
  // is redirected to the tenant's slug before rendering. Doing this on the
  // server avoids a client-side rewrite that races the router transition.
  const tenantSegment = /^\/t\/([^/]+)(\/.*)?$/.exec(requestUrl.pathname);

  if (
    event.request.method === "GET" &&
    (event.request.headers.get("accept") ?? "").includes("text/html") &&
    tenantSegment
  ) {
    const key = tenantSegment[1];
    const tenant = outcome.session?.me?.tenants.find((entry) => entry.id === key);

    if (tenant && tenant.slug && tenant.slug !== key)
      return Response.redirect(
        `${requestUrl.origin}/t/${tenant.slug}${tenantSegment[2] ?? ""}${requestUrl.search}`,
        302,
      );
  }

  const response = await api(event, next);

  // The SSR token is consumed by the web Worker itself. A browser reaching the
  // same endpoint through the /api proxy must never receive it. Compare the
  // normalised path because the API router accepts trailing and duplicate
  // slashes, percent-encoding and any case; matching the raw spelling would
  // let a variant proxy the token to browser JavaScript.
  const proxied = isBootstrapPath(new URL(event.request.url).pathname)
    ? await redactBootstrapResponse(response)
    : response;

  // Profile writes can change the shell cached in the SSR token; force the
  // next navigation to bootstrap once instead of serving the old snapshot.
  const profileUpdate =
    event.request.method === "PATCH" &&
    isProfileUpdatePath(new URL(event.request.url).pathname) &&
    response.ok;

  const afterProfileUpdate = profileUpdate ? expireSsrToken(proxied) : proxied;

  // Seed the client-visible presence cookie from the server's session check.
  // API responses already mirror session cookie rotations themselves.
  if (event.request.method !== "GET" || !isHtml(afterProfileUpdate)) return afterProfileUpdate;
  const presence = getPreloadedSession(event.request);
  const secure = new URL(event.request.url).protocol === "https:";

  if (
    presence === undefined &&
    registrationNonce === undefined &&
    outcome.setSsrCookie === undefined &&
    outcome.setSsrRevisionCookie === undefined &&
    !outcome.clearSsrCookie &&
    !outcome.clearSsrRevisionCookie
  )
    return afterProfileUpdate;

  const headers = new Headers(afterProfileUpdate.headers);

  // Set before the SSR/session cookies so the nonce is present even on a page
  // whose session preload produced nothing.
  if (registrationNonce !== undefined)
    headers.append("set-cookie", registrationNonceCookie(registrationNonce, secure));

  if (outcome.setSsrCookie) headers.append("set-cookie", outcome.setSsrCookie);

  if (outcome.setSsrRevisionCookie) headers.append("set-cookie", outcome.setSsrRevisionCookie);

  if (outcome.clearSsrCookie) headers.append("set-cookie", ssrClearCookie());

  if (outcome.clearSsrRevisionCookie) headers.append("set-cookie", ssrRevisionClearCookie());

  if (presence !== undefined)
    headers.append(
      "set-cookie",
      sessionPresenceSetCookie(
        presence === null ? null : Date.now() + SESSION_PRESENCE_MAX_AGE_SECONDS * 1000,
        secure,
      ),
    );

  return new Response(afterProfileUpdate.body, {
    status: afterProfileUpdate.status,
    statusText: afterProfileUpdate.statusText,
    headers,
  });
};

export default middleware;
