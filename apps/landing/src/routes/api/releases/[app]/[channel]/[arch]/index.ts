import type { APIEvent } from "@solidjs/start/server";

const staticUrl = "https://static.mattrax.app";
const supportedArchs = ["aarch64-unknown-linux", "x86_64-unknown-linux"];

export async function GET({ params }: APIEvent) {
	if (params.app !== "mattrax") return;
	if (!supportedArchs.includes(params.arch!)) return;

	if (params.channel === "stable") {
		// TODO: Use GitHub releases
		return new Response("Coming soon...", {
			status: 500,
		});
	} else if (params.channel === "nightly") {
		const resp = await fetch(`${staticUrl}/nightly`);
		if (!resp.ok)
			return new Response("Failed to fetch nightly commit hash", {
				status: 500,
			});
		const nightlyCommitHash = await resp.text();
		return Response.redirect(
			`${staticUrl}/mattrax/${nightlyCommitHash}/${params.arch}`,
			302,
		);
	}
}
