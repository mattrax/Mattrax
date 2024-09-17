import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbSeparator,
	Input,
} from "@mattrax/ui";
import { useCurrentMatches } from "@solidjs/router";
import { For, type JSX, type ParentProps } from "solid-js";

export function Page(
	props: ParentProps & { title: string; breadcrumbs: JSX.Element[] },
) {
	const matches = useCurrentMatches();

	// The tenant layout is the first match so this will resolve it's path
	const overviewPageHref = () => matches()?.[0]?.path || "/";

	return (
		<div class="grid flex-1 items-start gap-4 p-4 sm:px-6 sm:py-0 md:gap-8">
			<header class="flex justify-between">
				<Breadcrumb class="hidden md:flex">
					<BreadcrumbList>
						<BreadcrumbItem>
							<BreadcrumbLink href={overviewPageHref()}>
								{/* // TODO: Showing the tenant name??? */}
								Dashboard
							</BreadcrumbLink>
						</BreadcrumbItem>
						<For each={props.breadcrumbs || []}>
							{(v) => (
								<>
									<BreadcrumbSeparator />
									{v}
								</>
							)}
						</For>
					</BreadcrumbList>
				</Breadcrumb>

				<div class="relative ml-auto flex-1 md:grow-0">
					<span class="absolute left-2.5 top-2.5 h-4 w-4">
						<IconPhMagnifyingGlass class="text-zinc-500 dark:text-zinc-400" />
					</span>
					<Input
						type="search"
						placeholder="Search..."
						class="w-full rounded-lg bg-white pl-8 md:w-[200px] lg:w-[320px] dark:bg-zinc-950"
						disabled
					/>
				</div>
			</header>
			<h1 class="text-3xl font-bold tracking-tight">{props.title}</h1>
			<div>{props.children}</div>
		</div>
	);
}
