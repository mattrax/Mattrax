// Exposed as `@mattrax/api/client` so that it can be imported in the frontend

import type { TrpcServerFunctionOpts } from "@mattrax/trpc-server-function";
import { fromBody } from "@mattrax/trpc-server-function/seroval";

export { env } from "~/env";
export type * from "./trpc";

// This is basically a "use server" function that has been manually expanded.
export async function serverFunction(opts: TrpcServerFunctionOpts) {
	const result = await fetch("/api/trpc", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify(opts),
	});
	if (!result.ok) throw new Error(`HTTP error: ${result.status}`);
	if (result.headers.get("Content-Type") !== "text/javascript")
		throw new Error(
			`Invalid content type '${result.headers.get("Content-Type")}': ${await result.text()}`,
		);
	if (!result.body) throw new Error("No body");
	return await fromBody(result.body);
}
