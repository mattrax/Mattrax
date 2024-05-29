import { z } from "zod";
import { trpc } from "~/lib";
import { useZodParams } from "~/lib/useZodParams";
import { createNotFoundRedirect } from "~/lib/utils";

export function useUserId() {
	const params = useZodParams({ userId: z.string() });
	return () => params.userId;
}

export function useUser() {
	const userId = useUserId();

	const query = trpc.user.get.createQuery(() => ({
		userId: userId(),
	}));

	createNotFoundRedirect({
		query: query,
		toast: "User not found",
		to: "../../users",
	});

	return query;
}
