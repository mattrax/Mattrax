import { fetchApi } from "~/server/api";

const handleScimRequest = (event: { request: Request }) => fetchApi(event.request);

export const GET = handleScimRequest;
export const POST = handleScimRequest;
export const PUT = handleScimRequest;
export const PATCH = handleScimRequest;
export const DELETE = handleScimRequest;
export const OPTIONS = handleScimRequest;
