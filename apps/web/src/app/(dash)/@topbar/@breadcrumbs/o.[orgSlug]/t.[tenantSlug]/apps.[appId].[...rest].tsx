import { Badge } from "@mattrax/ui";
import { z } from "zod";

import { trpc } from "~/lib";
import { useZodParams } from "~/lib/useZodParams";
import { getMetadata } from "~[tenantSlug]/metadataCache";
import { Breadcrumb } from "../../Breadcrumb";

export default function () {
	const params = useZodParams({ appId: z.string() });

	const query = trpc.app.get.createQuery(() => ({
		appId: params.appId,
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
