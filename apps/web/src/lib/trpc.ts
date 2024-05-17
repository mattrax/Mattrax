import {
	type TrpcServerFunctionOpts,
	createServerFunctionLink,
	seroval,
	trpcServerFunction,
} from "@mattrax/trpc-server-function";
import { createTRPCSolidStart } from "@solid-mediakit/trpc";
import { useQueryClient } from "@tanstack/solid-query";
import { router, createContext, type AppRouter } from "~/api/trpc";

function serverFunction(opts: TrpcServerFunctionOpts) {
	"use server";

	return trpcServerFunction({ router, createContext, opts });
}

export const trpc = createTRPCSolidStart<AppRouter>({
	config: () => ({
		links: [createServerFunctionLink(serverFunction, useQueryClient())],
		transformer: seroval,
	}),
});
