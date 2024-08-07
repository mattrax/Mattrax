import { Badge } from "@mattrax/ui";

import { useDeviceId } from "~/app/(dash)/o.[orgSlug]/t.[tenantSlug]/devices/ctx";
import { getMetadata } from "~/app/(dash)/o.[orgSlug]/t.[tenantSlug]/metadataCache";
import { trpc } from "~/lib";
import { Breadcrumb } from "../../Breadcrumb";

export default function () {
	const deviceId = useDeviceId();
	const query = trpc.device.get.createQuery(() => ({
		deviceId: deviceId(),
	}));

	return (
		<Breadcrumb>
			<span>{getMetadata("device", deviceId())?.name ?? query.data?.name}</span>
			<Badge variant="outline">Device</Badge>
		</Breadcrumb>
	);
}
