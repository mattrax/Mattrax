import { Badge } from "@mattrax/ui";
import { z } from "zod";

import { getMetadata } from "~[tenantSlug]/metadataCache";
import { useZodParams } from "~/lib/useZodParams";
import { trpc } from "~/lib";
import { Breadcrumb } from "../../Breadcrumb";

export default function () {
	const params = useZodParams({ deviceId: z.string() });
	const query = trpc.device.get.createQuery(() => params);

	return (
		<Breadcrumb>
			<span>
				{getMetadata("device", params.deviceId)?.name ?? query.data?.name}
			</span>
			<Badge variant="outline">Device</Badge>
		</Breadcrumb>
	);
}
