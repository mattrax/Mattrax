import { env } from "cloudflare:workers";
import type { StartMiddleware } from "@solidjs/vite-plugin";
import { createAPIHandler } from "filesystem-routing/api";
import routes from "virtual:file-routes";
import {
  getPreloadedSession,
  type PreloadedSession,
  setPreloadedSession,
} from "~/lib/session-store";
import { SESSION_PRESENCE_MAX_AGE_SECONDS, sessionPresenceSetCookie } from "~/lib/session-presence";
import { setPostHogConfig } from "~/lib/posthog-config-store";

const api = createAPIHandler(routes);

/**
 * Load the signed-in session before the page renders.
 *
 * The API Worker owns auth, so ask it over the service binding with the
 * request's cookies. An answer lets the server render the signed-in shell
 * instead of flashing signed-out; a failure just leaves the client to ask
 * after hydration. The timeout stops a slow API from holding the document.
 */
async function preloadSession(request: Request): Promise<void> {
  if (request.method !== "GET") return;
  if (!(request.headers.get("accept") ?? "").includes("text/html")) return;

  const url = new URL(request.url);
  const headers = new Headers({
    "content-type": "application/json",
    "x-effect-auth-csrf": "1",
    origin: url.origin,
  });
  const cookie = request.headers.get("cookie");
  if (cookie) headers.set("cookie", cookie);

  try {
    const response = await env.API.fetch(
      new Request(new URL("/api/v1/getSession", url), {
        method: "POST",
        headers,
        body: "{}",
        signal: AbortSignal.timeout(2_000),
      }),
    );
    if (!response.ok) return;
    const data = (await response.json()) as { _tag?: string; value?: unknown } | null;
    if (data?._tag === "Success") {
      setPreloadedSession(request, (data.value ?? null) as PreloadedSession);
    }
  } catch {
    // The client will fetch the session after hydration.
  }
}

/**
 * Server middleware for the file-based HTTP routes.
 *
 * `/api/*` and `/mdm/*` proxy to the API Worker over its `API` service
 * binding; every other request falls through to the page render.
 */
const oauthMetadata = (url: URL): Response | undefined => {
  const origin = url.origin;
  const json = (body: unknown) =>
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
  const posthogKey = (env as { POSTHOG_KEY?: string }).POSTHOG_KEY?.trim();
  if (posthogKey)
    setPostHogConfig(event.request, {
      key: posthogKey,
      host: (env as { POSTHOG_HOST?: string }).POSTHOG_HOST?.trim() || "https://us.i.posthog.com",
    });
  await preloadSession(event.request);
  const response = await api(event, next);

  // Seed the client-visible presence cookie from the server's session check.
  // API responses already mirror session cookie rotations themselves.
  if (
    event.request.method !== "GET" ||
    !(response.headers.get("content-type") ?? "").includes("text/html")
  )
    return response;
  const presence = getPreloadedSession(event.request);
  if (presence === undefined) return response;
  const secure = new URL(event.request.url).protocol === "https:";
  const headers = new Headers(response.headers);
  headers.append(
    "set-cookie",
    sessionPresenceSetCookie(
      presence === null ? null : Date.now() + SESSION_PRESENCE_MAX_AGE_SECONDS * 1000,
      secure,
    ),
  );
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

export default middleware;
