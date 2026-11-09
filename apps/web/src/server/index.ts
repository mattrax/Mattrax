// Registers every server function before the first request is dispatched,
// including functions only referenced by client code.
import "virtual:solid-server-function-manifest";
import { handleRequest } from "virtual:solid-ssr-handler";

/**
 * The Cloudflare Worker entry.
 *
 * Start mode owns the page render (including the filesystem API routes through
 * `src/server/middleware.ts`) via `virtual:solid-ssr-handler`.
 */
export default {
  async fetch(request: Request): Promise<Response> {
    return handleRequest(request);
  },
} satisfies ExportedHandler<Env>;
