import {
	TrpcServerFunctionOpts,
	createServerFunctionLink,
	seroval,
	trpcServerFunction,
} from "@mattrax/trpc-solid-start";
import { createTRPCSolidStart } from "@solid-mediakit/trpc";

import { router, createContext } from "~/api/trpc";

const serverFunction = (opts: TrpcServerFunctionOpts) => {
	"use server";

	return trpcServerFunction({ router, createContext, opts });
};

export const trpc = createTRPCSolidStart({
	config: () => ({
		links: [createServerFunctionLink(serverFunction)],
		transformer: seroval,
	}),
});
