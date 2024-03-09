import { createTRPCSolidStart } from "@solid-mediakit/trpc";

import { AppRouter } from "~/api";
import { createServerFunctionLink } from "./serverFunctionLink";

export const trpc = createTRPCSolidStart<AppRouter>({
	config: () => ({
		links: [createServerFunctionLink()],
	}),
});
