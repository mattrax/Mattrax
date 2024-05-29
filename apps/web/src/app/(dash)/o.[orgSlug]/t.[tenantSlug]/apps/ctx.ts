import { trpc } from "~/lib";
import { z } from "zod";
import { useZodParams } from "~/lib/useZodParams";
import { createNotFoundRedirect } from "~/lib/utils";

export function useAppId() {
	const params = useZodParams({ appId: z.string() });
	return () => params.appId;
}

export function useApp() {
	const appId = useAppId();

	const query = trpc.app.get.createQuery(() => ({
		appId: appId(),
	}));

	createNotFoundRedirect({
		query: query,
		toast: "App not found",
		to: "../../apps",
	});

	return query;
}
