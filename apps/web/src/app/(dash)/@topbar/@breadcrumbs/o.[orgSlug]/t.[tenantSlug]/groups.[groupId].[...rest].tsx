import { Badge } from "@mattrax/ui";
import { z } from "zod";
import { trpc } from "~/lib";
import { useZodParams } from "~/lib/useZodParams";
import { getMetadata } from "~[tenantSlug]/metadataCache";
import { Breadcrumb } from "../../Breadcrumb";

export default function () {
	const params = useZodParams({ groupId: z.string() });

	const query = trpc.group.get.createQuery(() => ({
		groupId: params.groupId,
	}));

	return (
		<Breadcrumb>
			<span>
				{getMetadata("group", params.groupId)?.name ?? query.data?.name}
			</span>
			<Badge variant="outline">Group</Badge>
		</Breadcrumb>
	);
}
