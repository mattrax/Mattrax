import {
	type TrpcServerFunctionOpts,
	createServerFunctionLink,
	seroval,
	trpcServerFunction,
} from "@mattrax/trpc-server-function";
import { createTRPCSolidStart } from "@solid-mediakit/trpc";
import { createMemo } from "solid-js";
import { router, createContext, type AppRouter } from "~/api/trpc";

function serverFunction(opts: TrpcServerFunctionOpts) {
	"use server";

	return trpcServerFunction({ router, createContext, opts });
}

export const trpc = createTRPCSolidStart<AppRouter>({
	config: () => ({
		links: [createServerFunctionLink(serverFunction)],
		transformer: seroval,
	}),
});
