import { Badge } from "@mattrax/ui";

import { trpc } from "~/lib";
import { getMetadata } from "~[tenantSlug]/metadataCache";
import { Breadcrumb } from "../../Breadcrumb";
import { useAppId } from "~/app/(dash)/o.[orgSlug]/t.[tenantSlug]/apps/ctx";

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
