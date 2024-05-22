import { Badge } from "@mattrax/ui";
import { z } from "zod";
import { trpc } from "~/lib";
import { useZodParams } from "~/lib/useZodParams";
import { getMetadata } from "~[tenantSlug]/metadataCache";
import { Breadcrumb } from "../../Breadcrumb";

export default function () {
	const params = useZodParams({ userId: z.string() });

	const query = trpc.user.get.createQuery(() => ({
		id: params.userId,
	}));

	return (
		<Breadcrumb>
			<span>
				{getMetadata("user", params.userId)?.name ?? query.data?.name}
			</span>
			<Badge variant="outline">User</Badge>
		</Breadcrumb>
	);
}
