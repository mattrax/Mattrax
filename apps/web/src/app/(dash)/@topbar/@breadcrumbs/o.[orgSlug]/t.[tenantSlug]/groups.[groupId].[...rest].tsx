import { Badge } from "@mattrax/ui";
import { useGroupId } from "~/app/(dash)/o.[orgSlug]/t.[tenantSlug]/groups/ctx";
import { getMetadata } from "~/app/(dash)/o.[orgSlug]/t.[tenantSlug]/metadataCache";
import { trpc } from "~/lib";
import { Breadcrumb } from "../../Breadcrumb";

export default function () {
	const groupId = useGroupId();
	const query = trpc.group.get.createQuery(() => ({
		groupId: groupId(),
	}));

	return (
		<Breadcrumb>
			<span>{getMetadata("group", groupId())?.name ?? query.data?.name}</span>
			<Badge variant="outline">Group</Badge>
		</Breadcrumb>
	);
}
