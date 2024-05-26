import { Badge } from "@mattrax/ui";
import { z } from "zod";
import { trpc } from "~/lib";
import { useZodParams } from "~/lib/useZodParams";
import { getMetadata } from "~[tenantSlug]/metadataCache";
import { Breadcrumb } from "../../Breadcrumb";

export default function () {
	const params = useZodParams({ policyId: z.string() });

	const query = trpc.policy.get.createQuery(() => ({
		policyId: params.policyId,
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
