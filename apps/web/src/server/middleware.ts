import { env } from "cloudflare:workers";
import type { StartMiddleware } from "@solidjs/vite-plugin";
import { createAPIHandler } from "filesystem-routing/api";
import routes from "virtual:file-routes";
import { type PreloadedSession, setPreloadedSession } from "~/lib/session-store";

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
      new Request(new URL("/api/v1/auth/getSession", url), {
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
const middleware: StartMiddleware = async (event, next) => {
  await preloadSession(event.request);
  return api(event, next);
};

export default middleware;
