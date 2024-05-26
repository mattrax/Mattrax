import { Badge } from "@mattrax/ui";
import { trpc } from "~/lib";
import { getMetadata } from "~[tenantSlug]/metadataCache";
import { Breadcrumb } from "../../Breadcrumb";
import { usePolicyId } from "~/app/(dash)/o.[orgSlug]/t.[tenantSlug]/policies/ctx";

export default function () {
	const policyId = usePolicyId();
	const query = trpc.policy.get.createQuery(() => ({
		policyId: policyId(),
	}));

	return (
		<Breadcrumb>
			<span>{getMetadata("policy", policyId())?.name ?? query.data?.name}</span>
			<Badge variant="outline">Policy</Badge>
		</Breadcrumb>
	);
}
