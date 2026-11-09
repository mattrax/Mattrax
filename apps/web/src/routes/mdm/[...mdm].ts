import { env } from "cloudflare:workers";

const handleMdmRequest = (event: { request: Request }) => env.API.fetch(event.request);

export const GET = handleMdmRequest;
export const POST = handleMdmRequest;
export const PUT = handleMdmRequest;
export const PATCH = handleMdmRequest;
export const DELETE = handleMdmRequest;
export const OPTIONS = handleMdmRequest;
