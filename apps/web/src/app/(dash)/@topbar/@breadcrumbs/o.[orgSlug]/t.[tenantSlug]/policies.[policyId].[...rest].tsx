import { Badge } from "@mattrax/ui";
import { getMetadata } from "~/app/(dash)/o/o.[orgSlug]/t/[tenantSlug]/metadataCache";
import { usePolicyId } from "~/app/(dash)/o/o.[orgSlug]/t/[tenantSlug]/policies/ctx";
import { trpc } from "~/lib";
import { Breadcrumb } from "../../Breadcrumb";

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
