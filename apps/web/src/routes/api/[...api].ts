import { env } from "cloudflare:workers";

const handleApiRequest = (event: { request: Request }) => env.API.fetch(event.request);

export const GET = handleApiRequest;
export const POST = handleApiRequest;
export const PUT = handleApiRequest;
export const PATCH = handleApiRequest;
export const DELETE = handleApiRequest;
export const OPTIONS = handleApiRequest;
