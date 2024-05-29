import { z } from "zod";
import { trpc } from "~/lib";
import { useZodParams } from "~/lib/useZodParams";
import { createNotFoundRedirect } from "~/lib/utils";

export function useGroupId() {
	const params = useZodParams({ groupId: z.string() });
	return () => params.groupId;
}

export function useGroup() {
	const groupId = useGroupId();

	const query = trpc.group.get.createQuery(() => ({
		groupId: groupId(),
	}));

	createNotFoundRedirect({
		query: query,
		toast: "Group not found",
		to: "../../groups",
	});

	return query;
}
