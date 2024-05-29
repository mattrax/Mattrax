import { Badge } from "@mattrax/ui";
import { trpc } from "~/lib";
import { getMetadata } from "~[tenantSlug]/metadataCache";
import { Breadcrumb } from "../../Breadcrumb";
import { useGroupId } from "~/app/(dash)/o.[orgSlug]/t.[tenantSlug]/groups/ctx";

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
