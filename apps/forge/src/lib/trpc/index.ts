import { createTRPCSolidStart } from "@solid-mediakit/trpc";

import { AppRouter } from "~/api";
import { createServerFunctionLink, seroval } from "./serverFunctionLink";

export const trpc = createTRPCSolidStart<AppRouter>({
	config: () => ({
		links: [createServerFunctionLink()],
		transformer: seroval,
	}),
});
