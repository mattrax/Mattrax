import { BreadcrumbItem } from "@mattrax/ui";
import { Page } from "~/components/Page";
import { Table } from "~/components/Table";

export default function () {
	return (
		<Page
			title="Devices"
			breadcrumbs={[<BreadcrumbItem>Devices</BreadcrumbItem>]}
		>
			<Table data={[]} />
		</Page>
	);
}
