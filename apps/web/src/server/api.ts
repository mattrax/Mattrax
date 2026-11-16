import { getBindings } from "./bindings";

/**
 * Forward an API request to the API.
 *
 * The `Bindings` service owns the difference between the deployments: a
 * Cloudflare service binding (or `API_URL` for a preview) and a loopback call to
 * the API's Node process under `apps/docker`. Path, query, headers, cookies
 * and body are preserved by whichever client answers.
 */
export const fetchApi = (request: Request): Promise<Response> => getBindings().API.fetch(request);
