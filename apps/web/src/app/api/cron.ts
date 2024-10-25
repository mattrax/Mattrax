import type { APIEvent } from "@solidjs/start/server";
import { getActiveAuthority } from "~/api/authority";
import { env } from "~/env";

export async function GET({ request }: APIEvent) {
	const url = new URL(request.url);

	if (url.searchParams.get("secret") !== env.INTERNAL_SECRET)
		return new Response(JSON.stringify("Forbidden"), {
			status: 403,
			headers: { "Content-Type": "application/json" },
		});

	// Check if the authority certificate needs renewal
	await getActiveAuthority(true);

	// TODO: Clear inactive sessions

	return new Response("ok");
}
