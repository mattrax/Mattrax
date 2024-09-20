// import {
// 	Breadcrumb,
// 	BreadcrumbItem,
// 	BreadcrumbLink,
// 	BreadcrumbList,
// 	BreadcrumbSeparator,
// 	Input,
// } from "@mattrax/ui";
// import { useCurrentMatches } from "@solidjs/router";
// import { For, type JSX, type ParentProps, Show } from "solid-js";

// export function Page(
// 	props: ParentProps & {
// 		title: string | null;
// 		right?: JSX.Element;
// 		breadcrumbs: JSX.Element[];
// 		class?: string;
// 	},
// ) {
// 	const matches = useCurrentMatches();

// 	// The tenant layout is the first match so this will resolve it's path
// 	const overviewPageHref = () => matches()?.[0]?.path || "/";

// 	return (
// 		<div class="h-full flex flex-col p-4 sm:px-6 sm:py-2">
// 			<header class="flex justify-between h-[36px]">
// 				<Breadcrumb class="hidden md:flex">
// 					<BreadcrumbList>
// 						<BreadcrumbItem>
// 							<BreadcrumbLink href={overviewPageHref()}>
// 								{/* // TODO: Showing the tenant name??? */}
// 								Dashboard
// 							</BreadcrumbLink>
// 						</BreadcrumbItem>
// 						<For each={props.breadcrumbs || []}>
// 							{(v) => (
// 								<>
// 									<BreadcrumbSeparator />
// 									{v}
// 								</>
// 							)}
// 						</For>
// 					</BreadcrumbList>
// 				</Breadcrumb>
// 			</header>
// 			{/* <Show when={props.title !== null}>
// 				<div class="flex justify-between">
// 					<h1 class="text-3xl font-bold tracking-tight !mt-2 mb-4 md:mb-5">
// 						{props.title}
// 					</h1>

// 					<div>{props.right ?? null}</div>
// 				</div>
// 			</Show>
// 			<main class={props.class}>{props.children}</main> */}

// 			<div class="w-full flex justify-center">
// 				<div class="flex flex-col w-full max-w-3xl">
// 					<h1 class="text-3xl font-bold tracking-tight !mt-2 mb-4 md:mb-5">
// 						{props.title}
// 					</h1>

// 					<main class={props.class}>{props.children}</main>
// 				</div>
// 			</div>
// 		</div>
// 	);
// }

import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbSeparator,
	Input,
} from "@mattrax/ui";
import { useCurrentMatches } from "@solidjs/router";
import { For, type JSX, type ParentProps, Show } from "solid-js";

export function Page(
	props: ParentProps & {
		title: string | null;
		right?: JSX.Element;
		breadcrumbs: JSX.Element[];
		class?: string;
	},
) {
	const matches = useCurrentMatches();

	// The tenant layout is the first match so this will resolve it's path
	const overviewPageHref = () => matches()?.[0]?.path || "/";

	return (
		<div class="h-full flex flex-col p-4 sm:px-6 sm:py-2">
			<header class="flex justify-between h-[36px]">
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
			</header>
			{/* <Show when={props.title !== null}>
				<div class="flex justify-between">
					<h1 class="text-3xl font-bold tracking-tight !mt-2 mb-4 md:mb-5">
						{props.title}
					</h1>

					<div>{props.right ?? null}</div>
				</div>
			</Show> */}
			<main class={props.class}>{props.children}</main>
		</div>
	);
}
