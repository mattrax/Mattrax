// Registers every server function before the first request is dispatched,
// including functions only referenced by client code.
import "virtual:solid-server-function-manifest";
import { handleRequest } from "virtual:solid-ssr-handler";
import routes from "virtual:file-routes";
import docsRoutes from "virtual:docs-routes";
import { useWorkerBindings } from "./bindings";
import {
  canonicalHostUrl,
  compilePagePatterns,
  guardPath,
  isKnownPagePath,
  withSecurityHeaders,
} from "./security";
import { createSeoHandler } from "./seo";
import { DEPLOYMENT_ID } from "~/lib/deployment";
import { isCacheablePublicPage } from "~/lib/public-routes";

const seoResponse = createSeoHandler(docsRoutes);

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
 *
 * The same bundle runs on Node (`MATTRAX_TARGET=node`, hosted by
 * `src/server/node.ts`). The only difference is where bindings come from: the
 * platform hands them to this handler on Cloudflare, while Node resolves
 * `process.env` and a loopback API client. Nothing below this line needs to
 * know which runtime it is on.
 */
export default {
  async fetch(request: Request, env?: Env, ctx?: ExecutionContext): Promise<Response> {
    if (env) useWorkerBindings(env);

    const url = new URL(request.url);

    const canonical = canonicalHostUrl(url);

    if (canonical)
      return withSecurityHeaders(request, Response.redirect(canonical, 308), DEPLOYMENT_ID);

    if (guardPath(url.pathname) === "not-found")
      return withSecurityHeaders(request, notFound(), DEPLOYMENT_ID);

    // `robots.txt` and `sitemap.xml` need the request origin, so the asset
    // layer sends exactly those two paths here (`assets.runWorkerFirst`).
    const seo = seoResponse(request);

    if (seo) return withSecurityHeaders(request, seo, DEPLOYMENT_ID);

    // Public shells are identical for every visitor, so each colo keeps a
    // short copy. This is a per-colo edge cache, not a shared origin cache:
    // authenticated dashboard HTML never reaches this branch.
    const edgeCache =
      typeof caches !== "undefined" && isCacheablePublicPage(url.pathname)
        ? await caches.open("mattrax-public").catch(() => undefined)
        : undefined;

    if (edgeCache) {
      const cached = await edgeCache.match(request);

      if (cached) return withSecurityHeaders(request, cached, DEPLOYMENT_ID);
    }

    const response = await handleRequest(request);

    const finalResponse =
      response.status === 200 &&
      (request.method === "GET" || request.method === "HEAD") &&
      isHtmlResponse(response) &&
      !isKnownPagePath(url.pathname, pagePatterns)
        ? asNotFound(response)
        : response;

    const hardened = withSecurityHeaders(request, finalResponse, DEPLOYMENT_ID);

    if (
      edgeCache &&
      finalResponse.status === 200 &&
      !hardened.headers.has("set-cookie") &&
      (request.method === "GET" || request.method === "HEAD")
    )
      ctx?.waitUntil(edgeCache.put(request, hardened.clone()).catch(() => undefined));

    return hardened;
  },
} satisfies ExportedHandler<Env>;
