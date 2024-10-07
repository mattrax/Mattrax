import { Button } from "@mattrax/ui";
import { BreadcrumbItem, BreadcrumbLink } from "@mattrax/ui/breadcrumb";
import type { ParentProps } from "solid-js";
import { Page, SEPARATOR, Sidebar } from "~/components/Page";
import { useBlueprint } from "~/lib/data";

const sidebar = [
	{
		name: "General",
		href: "",
	},
	{
		name: "Applications",
		href: "apps",
	},
	{
		name: "Security",
		href: "security",
	},
	{
		name: "Wi-Fi",
		href: "wifi",
	},
	{
		name: "Restrictions",
		href: "restrictions",
	},
	{
		name: "Custom",
		href: "custom",
	},
	SEPARATOR,
	{
		name: "Devices",
		href: "devices",
	},
];

export default function (props: ParentProps) {
	const blueprint = useBlueprint();

	// TODO: Suspense
	return (
		<Page
			breadcrumbs={[
				<BreadcrumbItem>
					<BreadcrumbLink href="../../blueprints">Blueprints</BreadcrumbLink>
				</BreadcrumbItem>,
				<BreadcrumbItem bold>{blueprint.data?.name}</BreadcrumbItem>,
			]}
			class="flex h-full"
		>
			<Sidebar
				items={sidebar}
				top={
					<div class="flex">
						{/* // TODO: Tooltip */}
						<h1 class="text-3xl font-bold tracking-tight pb-1 truncate">
							{blueprint.data?.name}
						</h1>
						{/* // TODO: Actions working */}
						<Button variant="outline" class="!p-1 ml-auto">
							<IconPhDotsThreeOutlineVertical />
						</Button>
					</div>
				}
			/>
			<div class="p-4 flex-1 space-y-6 pt-4">{props.children}</div>
		</Page>
	);
}
