import { Badge } from "@mattrax/ui";
import { useUserId } from "~/app/(dash)/o.[orgSlug]/t.[tenantSlug]/users/ctx";
import { trpc } from "~/lib";
import { getMetadata } from "~[tenantSlug]/metadataCache";
import { Breadcrumb } from "../../Breadcrumb";

export default function () {
	const userId = useUserId();

	const query = trpc.user.get.createQuery(() => ({
		userId: userId(),
	}));

	return (
		<Breadcrumb>
			<span>{getMetadata("user", userId())?.name ?? query.data?.name}</span>
			<Badge variant="outline">User</Badge>
		</Breadcrumb>
	);
}
