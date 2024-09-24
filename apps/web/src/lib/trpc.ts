import type { AppRouter } from "@mattrax/api/client";
import {
	type TrpcServerFunctionOpts,
	createServerFunctionLink,
	seroval,
	trpcServerFunction,
} from "@mattrax/trpc-server-function";
import { createTRPCSolidStart } from "@solid-mediakit/trpc";
import { useQueryClient } from "@tanstack/solid-query";

// function serverFunction(opts: TrpcServerFunctionOpts) {
// 	"use server";

// 	return trpcServerFunction({ router, createContext, opts });
// }

export const trpc = createTRPCSolidStart<AppRouter>({
	config: () => ({
		links: [], // TODO: createServerFunctionLink(serverFunction, useQueryClient())
		transformer: seroval,
	}),
});
