import {
	TrpcServerFunctionOpts,
	createServerFunctionLink,
	seroval,
	trpcServerFunction,
} from "@mattrax/trpc-solid-start";
import { createTRPCSolidStart } from "@solid-mediakit/trpc";

import { Router, createTRPCContext, router } from "~/api";
import { getEvent } from "vinxi/http";

async function serverFunction(opts: TrpcServerFunctionOpts) {
	"use server";

	return trpcServerFunction({
		opts,
		router,
		createContext: () => createTRPCContext(getEvent()),
	});
}

export const trpc = createTRPCSolidStart<Router>({
	config: () => ({
		links: [createServerFunctionLink(serverFunction)],
		transformer: seroval,
	}),
});
