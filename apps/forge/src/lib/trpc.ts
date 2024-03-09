import {
	TrpcServerFunctionOpts,
	createServerFunctionLink,
	seroval,
	trpcServerFunction,
} from "@mattrax/trpc-solid-start";
import {
	CreateTRPCSolidStart,
	createTRPCSolidStart,
} from "@solid-mediakit/trpc";
import { getEvent } from "vinxi/http";

import { router, createContext, Router } from "~/api/trpc";

const serverFunction = (opts: TrpcServerFunctionOpts) => {
	"use server";

	try {
		console.log(getEvent());
	} catch (error) {
		console.error(error);
	}

	return trpcServerFunction({ router, createContext, opts });
};

export const trpc: CreateTRPCSolidStart<Router> = createTRPCSolidStart({
	config: () => ({
		links: [createServerFunctionLink(serverFunction)],
		transformer: seroval,
	}),
});
