import { env } from "cloudflare:workers";

export async function apiFetch(request: Request) {
  "use server";

  return await env.API.fetch(request);
}
