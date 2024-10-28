import type { APIEvent } from "@solidjs/start/server";

function handler({ request }: APIEvent) {
	if (request.headers.get("Accept")?.includes("application/json")) {
		return new Response(JSON.stringify({ error: "Not Found" }), {
			status: 404,
			headers: {
				"Content-Type": "application/json",
			},
		});
	}

	return new Response("404: Not Found", {
		status: 404,
		headers: {
			"Content-Type": "text/plain",
		},
	});
}

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const DELETE = handler;
export const PATCH = handler;
