import { Tabs } from "@kobalte/core/tabs";
import { A, useMatch } from "@solidjs/router";
import {
	For,
	type ParentProps,
	Show,
	children,
	createEffect,
	createSignal,
	onMount,
} from "solid-js";

export default function (props: ParentProps) {
	const items = children(() => {
		return props.children;
	}) as unknown as () =>
		| [{ items: { title: string; href: string }[]; base(): string }]
		| undefined;

	// When `props.children` is undefined due to lazy loading we need to hold around the old items
	const [cachedItems, setCachedItems] = createSignal(items()?.[0]);
	createEffect(() => setCachedItems(items()?.[0]));

	return (
		<Show when={cachedItems()}>
			{(items) => {
				const prefix = () => items().base();

				const match = useMatch(() => `${prefix()}/:value/*rest`);

				const value = () => match()?.params.value ?? "";

				const [mounted, setMounted] = createSignal(false);

				// Wait for the first render + a microtask to finish before animating the indicator
				onMount(() => setTimeout(() => setMounted(true), 5));

				return (
					<Tabs
						as="nav"
						value={`${prefix()}/${value()}`}
						class="bg-white text-white sticky top-0 z-40 -mt-2 overflow-x-auto scrollbar-none shrink-0 flex flex-row"
					>
						{/* Tab list nedes to remount each time items change to make sure the selected tab gets updated at the right time */}
						<Show when={items()} keyed>
							<Tabs.List class="flex flex-row px-2 border-b border-gray-200 w-full">
								<For each={items().items}>
									{(item) => (
										<Tabs.Trigger
											value={`${prefix()}/${item.href}`}
											as={A}
											end={item.href === ""}
											href={
												item.href === "" ? prefix() : `${prefix()}/${item.href}`
											}
											activeClass="text-black selected"
											inactiveClass="text-gray-500"
											class="py-2 flex text-center align-middle relative group focus:outline-none"
										>
											<div class="text-sm rounded px-3 py-1.5 hover:bg-black/5 hover:text-black group-focus-visible:bg-black/5 group-focus-visible:text-black group-focus:outline-none transition-colors duration-75">
												{item.title}
											</div>
										</Tabs.Trigger>
									)}
								</For>
							</Tabs.List>
						</Show>
						<Tabs.Indicator
							class="absolute bottom-0 flex flex-row px-2 h-[2px]"
							classList={{ "duration-200 transition-all": mounted() }}
						>
							<div class="bg-brand flex-1 rounded-full" />
						</Tabs.Indicator>
					</Tabs>
				);
			}}
		</Show>
	);
}
