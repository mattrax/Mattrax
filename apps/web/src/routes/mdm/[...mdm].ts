import { env } from "cloudflare:workers";

const handleApiRequest = (event: { request: Request }) => {
  if (import.meta.env.DEV) return env.API.fetch(event.request);
  return new Response("Routing configuration is invalid!", { status: 500 });
};

export const GET = handleApiRequest;
export const POST = handleApiRequest;
export const PUT = handleApiRequest;
export const PATCH = handleApiRequest;
export const DELETE = handleApiRequest;
export const OPTIONS = handleApiRequest;
