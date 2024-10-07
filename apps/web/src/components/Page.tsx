import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbSeparator,
	Kbd,
	Separator,
	buttonVariants,
	getPlatformShortcut,
} from "@mattrax/ui";
import { A, useCurrentMatches } from "@solidjs/router";
import clsx from "clsx";
import { For, type JSX, type ParentProps, Show } from "solid-js";
import { z } from "zod";
import { useTenant } from "~/app/(dash)";
import { useZodParams } from "~/lib/useZodParams";

export function Page(
	props: ParentProps & {
		breadcrumbs: JSX.Element[];
		class?: string;
	},
) {
	const params = useZodParams({
		tenantId: z.string().optional(),
	});
	const matches = useCurrentMatches();

	// The tenant layout is the first match so this will resolve it's path
	const overviewPageHref = () => matches()?.[0]?.path || "/";

	return (
		<div class="h-full flex flex-col">
			<header class="flex items-center h-[49px] border-b px-4 py-3 bg-white">
				{/* // TODO: Only show when required? */}
				{/* <Button
					variant="outline"
					size="sm"
					onClick={() => alert("todo")}
					class="mr-4"
				>
					<IconPhList />
				</Button> */}

				<Breadcrumb>
					<BreadcrumbList>
						<Show
							when={params.tenantId}
							fallback={
								<BreadcrumbItem>
									<BreadcrumbLink href={overviewPageHref()} class="font-medium">
										Dashboard
									</BreadcrumbLink>
								</BreadcrumbItem>
							}
						>
							<TenantBreadcrumbItem overviewPageHref={overviewPageHref()} />
						</Show>

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

				<div class="max-w-48 ml-auto">
					<div class="relative flex items-center">
						<button
							type="button"
							class="bg-zinc-100/80 border flex h-8 flex-1 items-center gap-2 overflow-hidden rounded-md px-1.5 text-sm text-zinc-500 font-medium outline-none ring-zinc-950 transition-all hover:bg-zinc-100 hover:text-zinc-900 focus-visible:ring-2 dark:ring-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-50 disabled:pointer-events-none disabled:opacity-50"
							disabled
						>
							<IconPhMagnifyingGlass class="h-4 w-4 shrink-0" />
							<div class="flex flex-1 overflow-hidden">
								<div class="line-clamp-1 pr-6">Search</div>
							</div>

							<Kbd>{getPlatformShortcut()} K</Kbd>
						</button>
					</div>
				</div>
			</header>

			<main class={props.class}>{props.children}</main>
		</div>
	);
}

function TenantBreadcrumbItem(props: { overviewPageHref: string }) {
	// This hook will throw if not scoped so we do that.
	const tenant = useTenant();

	return (
		<BreadcrumbItem>
			<BreadcrumbLink href={props.overviewPageHref} class="font-medium">
				{/* // TODO: Suspense behaviour */}
				{tenant()?.name}
			</BreadcrumbLink>
		</BreadcrumbItem>
	);
}

export const SEPARATOR = Symbol("SEPARATOR");

export function Sidebar(props: {
	top?: JSX.Element;
	items: ({ name: string; href: string } | symbol)[];
	bottom?: JSX.Element;
}) {
	return (
		<aside class="flex flex-col bg-white p-4 max-w-52 w-full h-full border-r space-y-1">
			{props.top}

			<For each={props.items}>
				{(item) => {
					if (item === SEPARATOR)
						return (
							<div class="py-1">
								<Separator />
							</div>
						);
					if (typeof item === "symbol")
						throw new Error(`Invalid symbol as Sidebar item: ${String(item)}`);

					return (
						<A
							end
							href={item.href}
							class={clsx(
								buttonVariants({ variant: "ghost" }),
								"!justify-start",
							)}
							activeClass="bg-muted hover:bg-muted"
							inactiveClass="hover:bg-transparent hover:underline"
						>
							{item.name}
						</A>
					);
				}}
			</For>

			<div class="flex-1" />

			{props.bottom}
		</aside>
	);
}
