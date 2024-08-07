import { Badge } from "@mattrax/ui";

import { useAppId } from "~/app/(dash)/o.[orgSlug]/t.[tenantSlug]/apps/ctx";
import { getMetadata } from "~/app/(dash)/o.[orgSlug]/t.[tenantSlug]/metadataCache";
import { trpc } from "~/lib";
import { Breadcrumb } from "../../Breadcrumb";

export default function () {
	const appId = useAppId();
	const query = trpc.app.get.createQuery(() => ({
		appId: appId(),
	}));

	return (
		<Breadcrumb>
			<span>
				{getMetadata("application", appId())?.name ?? query.data?.name}
			</span>
			<Badge variant="outline">App</Badge>
		</Breadcrumb>
	);
}
