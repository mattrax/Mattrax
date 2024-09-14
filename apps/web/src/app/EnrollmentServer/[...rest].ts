import type { APIEvent } from "@solidjs/start/server";
import { env } from "~/env";

async function handler({ request, params }: APIEvent) {
	console.log(params.rest);

	const url = new URL(env.RUST_URL);
	url.pathname = params.rest!;
	console.log(url.toString());
	const resp = await fetch(url.toString(), {
		method: request.method,
		headers: request.headers,
		body: request.body,
	});
	const headers = new Headers(resp.headers);
	headers.delete("content-encoding"); // SS has a fit if we pass this through
	headers.delete("strict-transport-security");
	return new Response(resp.body, {
		status: resp.status,
		statusText: resp.statusText,
		headers,
	});
}

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
