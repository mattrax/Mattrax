import { Badge } from "@mattrax/ui";

import { trpc } from "~/lib";
import { getMetadata } from "~[tenantSlug]/metadataCache";
import { Breadcrumb } from "../../Breadcrumb";
import { useDeviceId } from "~/app/(dash)/o.[orgSlug]/t.[tenantSlug]/devices/ctx";

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
