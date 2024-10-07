import { BreadcrumbItem, BreadcrumbLink } from "@mattrax/ui";
import { Page } from "~/components/Page";

export default function () {
	const url = `ms-device-enrollment:?mode=mdm&username=${encodeURIComponent("enroll@mattrax.app")}&servername=${encodeURIComponent(
		window.origin,
	)}`;

	return (
		<Page
			breadcrumbs={[
				<BreadcrumbItem>
					<BreadcrumbLink href="..">Devices</BreadcrumbLink>
				</BreadcrumbItem>,
				<BreadcrumbItem bold>Enroll</BreadcrumbItem>,
			]}
			class="p-4"
		>
			<h1 class="text-3xl font-bold tracking-tight">Enroll Device</h1>
			<p class="text-sm text-zinc-500 dark:text-zinc-400">Coming soon</p>

			<a href={url}>Enroll</a>
		</Page>
	);
}
