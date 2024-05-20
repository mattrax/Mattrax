import { z } from "zod";
import { getMetadata } from "~[tenantSlug]/metadataCache";
import { useZodParams } from "~/lib/useZodParams";
import { Badge } from "@mattrax/ui";
import { trpc } from "~/lib";

export default function () {
	const params = useZodParams({ groupId: z.string() });

	const query = trpc.group.get.createQuery(() => ({
		id: params.groupId,
	}));

	return {
		breadcrumb: (
			<>
				<span>
					{getMetadata("group", params.groupId)?.name ?? query.data?.name}
				</span>
				<Badge variant="outline">Group</Badge>
			</>
		),
	};
}
