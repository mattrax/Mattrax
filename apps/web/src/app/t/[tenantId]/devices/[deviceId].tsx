import { BreadcrumbItem, BreadcrumbLink } from "@mattrax/ui/breadcrumb";
import { z } from "zod";
import { Page } from "~/components/Page";
import { useZodParams } from "~/lib/useZodParams";

export default function () {
	const params = useZodParams({ deviceId: z.string() });

	// TODO: Hook up the API
	const deviceName = `${params.deviceId}'s Device`;

	return (
		<Page
			title="Devices"
			breadcrumbs={[
				<BreadcrumbItem>
					<BreadcrumbLink href="../../devices">Devices</BreadcrumbLink>
				</BreadcrumbItem>,
				<BreadcrumbItem>
					<BreadcrumbItem>{deviceName}</BreadcrumbItem>
				</BreadcrumbItem>,
			]}
		>
			<h1>Hello World</h1>
		</Page>
	);
}
