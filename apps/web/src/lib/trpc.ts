import { type AppRouter, serverFunction } from "@mattrax/api/client";
import {
	createServerFunctionLink,
	seroval,
} from "@mattrax/trpc-server-function";
import { createTRPCSolidStart } from "@solid-mediakit/trpc";
import { useQueryClient } from "@tanstack/solid-query";

// function serverFunction(opts: TrpcServerFunctionOpts) {
// 	"use server";

// 	return trpcServerFunction({ router, createContext, opts });
// }

export const trpc = createTRPCSolidStart<AppRouter>({
	config: () => ({
		links: [createServerFunctionLink(serverFunction, useQueryClient())],
		transformer: seroval,
	}),
});
