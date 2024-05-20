import { z } from "zod";
import { getMetadata } from "~[tenantSlug]/metadataCache";
import { useZodParams } from "~/lib/useZodParams";
import { Badge } from "@mattrax/ui";
import { trpc } from "~/lib";

export default function () {
	const params = useZodParams({ userId: z.string() });

	const query = trpc.user.get.createQuery(() => ({
		id: params.userId,
	}));

	return {
		breadcrumb: (
			<>
				<span>
					{getMetadata("user", params.userId)?.name ?? query.data?.name}
				</span>
				<Badge variant="outline">User</Badge>
			</>
		),
	};
}
