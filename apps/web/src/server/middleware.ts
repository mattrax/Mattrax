import { env } from "cloudflare:workers";
import type { StartMiddleware } from "@solidjs/vite-plugin";
import { Option, Schema } from "effect";
import { createAPIHandler } from "filesystem-routing/api";
import routes from "virtual:file-routes";
import {
  getPreloadedSession,
  setPreloadedSession,
} from "~/lib/session-store";
import { SESSION_PRESENCE_MAX_AGE_SECONDS, sessionPresenceSetCookie } from "~/lib/session-presence";
import { setPostHogConfig } from "~/lib/posthog-config-store";
import { preloadSession, redactBootstrapResponse, ssrClearCookie } from "./preload";
import { isBootstrapPath } from "./security";
import { verifySsrToken } from "./ssr-token";

const api = createAPIHandler(routes);

// Per-isolate one-shot reports. The SSR token is an optimisation: with a
// missing or mismatched secret the page still renders from bootstrap, but every
// navigation pays the API round trip. `console.error` makes Workers Issues
// group the misconfiguration instead of hiding it among warnings.
let reportedMissingAuthSecret = false;
let reportedSsrTokenRejected = false;

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

const PostHogEnv = Schema.Struct({
  POSTHOG_KEY: Schema.optional(Schema.String),
  POSTHOG_HOST: Schema.optional(Schema.String),
});

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

  return env.API.fetch(
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
 * `/api/*` and `/mdm/*` proxy to the API Worker over its `API` service
 * binding; every other request falls through to the page render.
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
  const metadata = oauthMetadata(new URL(event.request.url));

  if (metadata) return metadata;
  const posthogEnv = Option.getOrUndefined(Schema.decodeUnknownOption(PostHogEnv)(env));
  const posthogKey = posthogEnv?.POSTHOG_KEY?.trim();

  if (posthogKey)
    setPostHogConfig(event.request, {
      key: posthogKey,
      host: posthogEnv?.POSTHOG_HOST?.trim() || "https://us.i.posthog.com",
    });

  if (!env.AUTH_SECRET) reportMissingAuthSecret();

  const outcome = await preloadSession(event.request, {
    secret: env.AUTH_SECRET,
    verifyToken: verifySsrToken,
    fetchBootstrap,
  });

  if (outcome.ssrTokenRejected) reportSsrTokenRejected();

  if (outcome.session !== undefined) setPreloadedSession(event.request, outcome.session);

  const response = await api(event, next);

  // The SSR token is consumed by the web Worker itself. A browser reaching the
  // same endpoint through the /api proxy must never receive it. Compare the
  // normalised path because the API router accepts trailing and duplicate
  // slashes, percent-encoding and any case; matching the raw spelling would
  // let a variant proxy the token to browser JavaScript.
  const proxied = isBootstrapPath(new URL(event.request.url).pathname)
    ? await redactBootstrapResponse(response)
    : response;

  // Seed the client-visible presence cookie from the server's session check.
  // API responses already mirror session cookie rotations themselves.
  if (event.request.method !== "GET" || !isHtml(proxied)) return proxied;
  const presence = getPreloadedSession(event.request);

  if (presence === undefined && outcome.setSsrCookie === undefined && !outcome.clearSsrCookie)
    return proxied;

  const secure = new URL(event.request.url).protocol === "https:";
  const headers = new Headers(proxied.headers);

  if (outcome.setSsrCookie) headers.append("set-cookie", outcome.setSsrCookie);

  if (outcome.clearSsrCookie) headers.append("set-cookie", ssrClearCookie());

  if (presence !== undefined)
    headers.append(
      "set-cookie",
      sessionPresenceSetCookie(
        presence === null ? null : Date.now() + SESSION_PRESENCE_MAX_AGE_SECONDS * 1000,
        secure,
      ),
    );

  return new Response(proxied.body, {
    status: proxied.status,
    statusText: proxied.statusText,
    headers,
  });
};

export default middleware;
