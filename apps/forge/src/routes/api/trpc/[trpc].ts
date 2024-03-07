import { createSolidAPIHandler } from "@solid-mediakit/trpc/handler";

import { appRouter, createTRPCContext } from "~/api/trpc";

const handler = createSolidAPIHandler({
	router: appRouter,
	createContext: () => createTRPCContext(),
});

export const { GET, POST } = handler;
