import { z } from "zod";
import { getMetadata } from "~[tenantSlug]/metadataCache";
import { useZodParams } from "~/lib/useZodParams";
import { Badge } from "@mattrax/ui";
import { trpc } from "~/lib";
import { Breadcrumb } from "../../Breadcrumb";

export default function () {
	const params = useZodParams({ policyId: z.string() });

	const query = trpc.policy.get.createQuery(() => ({
		id: params.policyId,
	}));

	return (
		<Breadcrumb>
			<span>
				{getMetadata("policy", params.policyId)?.name ?? query.data?.name}
			</span>
			<Badge variant="outline">Policy</Badge>
		</Breadcrumb>
	);
}
