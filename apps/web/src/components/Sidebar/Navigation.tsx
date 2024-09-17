import {
	Button,
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@mattrax/ui";
import { A } from "@solidjs/router";
import { type JSX, Show } from "solid-js";

export function Navigation(props: {
	tenantId: string | undefined;
	disabled: boolean;
}) {
	const resolvePath = (path: string) => `/t/${props.tenantId}/${path}`;

	const item = (
		title: string,
		href: string,
		icon?: (props: { class: string }) => JSX.Element,
	) => (
		<li>
			<div class="relative flex items-center">
				<A
					href={resolvePath(href)}
					class="min-w-8 flex h-8 flex-1 items-center gap-2 overflow-hidden rounded-md px-1.5 text-sm font-medium outline-none ring-zinc-950 transition-all hover:bg-zinc-100 hover:text-zinc-900 focus-visible:ring-2 dark:ring-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
					activeClass={props.disabled ? "" : "bg-zinc-200"}
					end
					aria-disabled={props.disabled}
					classList={{
						"pointer-events-none": props.disabled,
						"opacity-50": props.disabled,
					}}
				>
					<Show when={icon} keyed>
						{(Icon) => <Icon class="h-4 w-4 shrink-0" />}
					</Show>
					<div class="flex flex-1 overflow-hidden">
						<div class="line-clamp-1 pr-6">{title}</div>
					</div>
				</A>
			</div>
		</li>
	);

	return (
		<ul class="grid gap-0.5">
			{item("Overview", "", IconPhGear)}
			{/* // TODO: Hook up this active state: defaultOpen={item.isActive} */}
			<Collapsible>
				<li>
					<div class="relative flex items-center">
						<A
							href={resolvePath("devices")}
							class="min-w-8 flex h-8 flex-1 items-center gap-2 overflow-hidden rounded-md px-1.5 text-sm font-medium outline-none ring-zinc-950 transition-all hover:bg-zinc-100 hover:text-zinc-900 focus-visible:ring-2 dark:ring-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
							activeClass="bg-zinc-200"
							aria-disabled={props.disabled}
							classList={{
								"pointer-events-none": props.disabled,
								"opacity-50": props.disabled,
							}}
						>
							<IconPhLaptop class="h-4 w-4 shrink-0" />
							<div class="flex flex-1 overflow-hidden">
								<div class="line-clamp-1 pr-6">Devices</div>
							</div>
						</A>
						<CollapsibleTrigger
							as={Button}
							variant="ghost"
							class="absolute right-1 h-6 w-6 rounded-md p-0 ring-zinc-950 transition-all focus-visible:ring-2 data-[state=open]:rotate-90 dark:ring-zinc-300"
							disabled={props.disabled}
						>
							<span>
								<IconPhCaretDown class="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
							</span>
							<span class="sr-only">Toggle</span>
						</CollapsibleTrigger>
					</div>
					<CollapsibleContent class="px-4 py-0.5">
						<ul class="grid border-l px-2">
							<li>
								<A
									href={resolvePath("devices/enroll")}
									class="min-w-8 flex h-8 items-center gap-2 overflow-hidden rounded-md px-2 text-sm font-medium text-zinc-500 ring-zinc-950 transition-all hover:bg-zinc-100 hover:text-zinc-900 focus-visible:ring-2 dark:text-zinc-400 dark:ring-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
								>
									<div class="line-clamp-1">Enroll</div>
								</A>
							</li>
						</ul>
					</CollapsibleContent>
				</li>
			</Collapsible>
			{item("Blueprints", "blueprints", IconPhScroll)}
			{item("Settings", "settings", IconPhGear)}
		</ul>
	);
}
