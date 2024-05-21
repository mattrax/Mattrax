import { Badge } from "@mattrax/ui";
import { z } from "zod";

import { getMetadata } from "~[tenantSlug]/metadataCache";
import { useZodParams } from "~/lib/useZodParams";
import { trpc } from "~/lib";
import { Breadcrumb } from "../../Breadcrumb";

export default function () {
	const params = useZodParams({ appId: z.string() });

	const query = trpc.app.get.createQuery(() => ({
		id: params.appId,
	}));

	return (
		<Breadcrumb>
			<span>
				{getMetadata("application", params.appId)?.name ?? query.data?.name}
			</span>
			<Badge variant="outline">App</Badge>
		</Breadcrumb>
	);
}
