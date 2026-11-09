/// <reference types="filesystem-routing/types" />

/** Types for the virtual modules provided by `@solidjs/vite-plugin` start mode. */

declare module "virtual:solid-ssr-handler" {
  export interface SolidHandlerOptions {
    /** Extra fields added to the request event, for example `nativeEvent`. */
    event?: Record<string, unknown>;
  }

  /**
   * Renders a page request with the app, or returns the `Response` an authored
   * server entry or `start.middleware` produced.
   */
  export function handleRequest(request: Request, options?: SolidHandlerOptions): Promise<Response>;

  const handler: { fetch(request: Request): Promise<Response> };
  export default handler;
}

// Side-effect module: importing it loads every module containing server
// functions so their registrations exist before requests are dispatched.
declare module "virtual:solid-server-function-manifest" {}
