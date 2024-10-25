import {
	type TrpcServerFunctionOpts,
	trpcServerFunction,
} from "@mattrax/trpc-server-function";
import { toReadableStream } from "@mattrax/trpc-server-function/seroval";
import type { APIEvent } from "@solidjs/start/server";
import { createTRPCContext, router } from "~/api/trpc";

async function handler({ request }: APIEvent) {
	const opts: TrpcServerFunctionOpts = await request.json();
	const result = await trpcServerFunction({
		router,
		ctx: createTRPCContext(),
		opts,
	});

	return new Response(toReadableStream(result), {
		headers: {
			"Content-Type": "text/javascript",
		},
	});
}

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const DELETE = handler;
export const PATCH = handler;
