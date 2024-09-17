import { BreadcrumbItem, BreadcrumbLink } from "@mattrax/ui";
import { Page } from "~/components/Page";

export default function () {
	return (
		<Page
			title="Enroll Device"
			breadcrumbs={[
				<BreadcrumbItem>
					<BreadcrumbLink href="..">Devices</BreadcrumbLink>
				</BreadcrumbItem>,
				<BreadcrumbItem>Enroll</BreadcrumbItem>,
			]}
		>
			<h1>Hello World!</h1>
		</Page>
	);
}
