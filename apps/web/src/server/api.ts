import { env } from "cloudflare:workers";

/**
 * Forward an API request to the API Worker.
 *
 * Production uses the `API` service binding. A Preview of this Worker cannot
 * use a service binding to another Worker's Preview — Cloudflare resolves it
 * to that Worker's production deployment — so the preview deploy passes the
 * preview API's generated URL as `API_URL` and requests go there over HTTP
 * instead. The path, query, headers, cookies and body are preserved.
 */
export const fetchApi = (request: Request): Promise<Response> => {
  if (!env.API_URL) return env.API.fetch(request);

  const source = new URL(request.url);
  const target = new URL(source.pathname + source.search, env.API_URL);

  return fetch(new Request(target, request));
};
