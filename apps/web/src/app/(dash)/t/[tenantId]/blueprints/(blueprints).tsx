import { BreadcrumbItem } from "@mattrax/ui";
import { Page } from "~/components/Page";
import { Table } from "~/components/Table";

export default function () {
	return (
		<Page
			title="Blueprints"
			breadcrumbs={[
				<BreadcrumbItem>
					<BreadcrumbItem>Blueprints</BreadcrumbItem>
				</BreadcrumbItem>,
			]}
		>
			<Table />
		</Page>
	);
}
