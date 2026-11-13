// Registers every server function before the first request is dispatched,
// including functions only referenced by client code.
import "virtual:solid-server-function-manifest";
import { handleRequest } from "virtual:solid-ssr-handler";

/**
 * Security headers for every response from the dashboard Worker.
 *
 * `frame-ancestors 'none'` plus `X-Frame-Options` prevents clickjacking, and
 * `nosniff`/`Referrer-Policy`/HSTS cover the remaining browser defaults. The
 * CSP deliberately does not restrict scripts or styles here: the SSR bundle
 * and the bundled docs use inline bootstrapping, and a narrow `frame-ancestors`
 * policy provides the required protection without breaking those surfaces.
 */
function withSecurityHeaders(request: Request, response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-frame-options", "DENY");
  headers.set("referrer-policy", "strict-origin-when-cross-origin");

  const contentType = headers.get("content-type") ?? "";

  if (contentType.includes("text/html")) {
    headers.set(
      "content-security-policy",
      "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'",
    );
  }

  // Only advertise HSTS over HTTPS; sending it from local HTTP would poison a
  // developer's browser for every localhost service.
  if (new URL(request.url).protocol === "https:") {
    headers.set("strict-transport-security", "max-age=31536000; includeSubDomains");
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * The Cloudflare Worker entry.
 *
 * Start mode owns the page render (including the filesystem API routes through
 * `src/server/middleware.ts`) via `virtual:solid-ssr-handler`.
 */
export default {
  async fetch(request: Request): Promise<Response> {
    const response = await handleRequest(request);

    return withSecurityHeaders(request, response);
  },
} satisfies ExportedHandler<Env>;
