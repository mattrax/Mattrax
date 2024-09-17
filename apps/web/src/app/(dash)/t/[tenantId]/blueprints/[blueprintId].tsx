import { BreadcrumbItem, BreadcrumbLink } from "@mattrax/ui/breadcrumb";
import { z } from "zod";
import { Page, Page2 } from "~/components/Page";
import { useZodParams } from "~/lib/useZodParams";

export default function () {
	const params = useZodParams({ blueprintId: z.string() });

	// TODO: Hook up the API
	const blueprintName = "Marketing Blueprint";

	return (
		<Page2
			breadcrumbs={[
				<BreadcrumbItem>
					<BreadcrumbLink href="../../blueprints">Blueprints</BreadcrumbLink>
				</BreadcrumbItem>,
				<BreadcrumbItem class="font-bold text-black/60">
					{blueprintName}
				</BreadcrumbItem>,
			]}
		>
			<div class="flex items-center space-x-4 p-4 w-full">
				<IconPhScroll class="w-20 h-20" />
				<div>
					<h1 class="text-3xl font-bold">{blueprintName}</h1>
					<h2 class="flex items-center mt-1 opacity-80 text-sm">
						{/* // TODO: Show the supported OS's */}
						<IconLogosMicrosoftWindowsIcon class="mr-2" />
					</h2>
				</div>
			</div>

			<div class="flex flex-col space-y-8 lg:flex-row lg:space-x-12 lg:space-y-0">
				<aside class="-mx-4 lg:w-1/5">
					{/* // TODO: Implement the sidebar: https://github.com/shadcn-ui/ui/blob/main/apps/www/components/sidebar-nav.tsx */}
					<h1>TODO: Navbar</h1>
					{/* <SidebarNav items={sidebarNavItems} /> */}
				</aside>
				<div class="flex-1 lg:max-w-2xl">
					<h1>Hello World</h1>
				</div>
			</div>
		</Page2>
	);
}
