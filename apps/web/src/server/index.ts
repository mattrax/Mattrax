// Registers every server function before the first request is dispatched,
// including functions only referenced by client code.
import "virtual:solid-server-function-manifest";
import { handleRequest } from "virtual:solid-ssr-handler";
import routes from "virtual:file-routes";
import {
  compilePagePatterns,
  guardPath,
  isKnownPagePath,
  withSecurityHeaders,
} from "./security";

/**
 * Page patterns from the filesystem manifest. The catch-all 404 route is
 * excluded by the compiler so an unmatched path can be identified and answered
 * with a real 404 status instead of the catch-all's default 200.
 */
const pagePatterns = compilePagePatterns(
  routes.filter((route) => route.page === true).map((route) => route.path),
);

const notFound = (): Response =>
  new Response("Not Found", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });

const isHtmlResponse = (response: Response): boolean =>
  (response.headers.get("content-type") ?? "").includes("text/html");

const asNotFound = (response: Response): Response =>
  new Response(response.body, {
    status: 404,
    statusText: "Not Found",
    headers: response.headers,
  });

/**
 * The Cloudflare Worker entry.
 *
 * Start mode owns the page render (including the filesystem API routes through
 * `src/server/middleware.ts`) via `virtual:solid-ssr-handler`.
 *
 * Before SSR, bot probes and dotfile paths are rejected, and unmatched
 * `/docs/*` requests (the docs are static assets) return 404 instead of the
 * SPA fallback loop. After SSR, an unknown page path keeps the rendered 404
 * page but reports a 404 status, and every response receives the shared
 * security headers.
 */
export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (guardPath(url.pathname) === "not-found") return withSecurityHeaders(request, notFound());

    const response = await handleRequest(request);

    const finalResponse =
      response.status === 200 &&
      (request.method === "GET" || request.method === "HEAD") &&
      isHtmlResponse(response) &&
      !isKnownPagePath(url.pathname, pagePatterns)
        ? asNotFound(response)
        : response;

    return withSecurityHeaders(request, finalResponse);
  },
} satisfies ExportedHandler<Env>;
