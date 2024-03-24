import { A } from "@solidjs/router";
import { As, Tabs } from "@kobalte/core";
import { For, Show } from "solid-js";

import { useNavItemsContext } from "./Context";

export * from "./Context";

export function NavItems() {
	const { items, value, prefix } = useNavItemsContext();

	return (
		<Show when={items()} keyed>
			{(items) => (
				<Tabs.Root
					as="nav"
					value={value()}
					class="text-white sticky top-0 z-10 bg-white -mt-2 overflow-x-auto scrollbar-none shrink-0 flex flex-row"
				>
					<Tabs.List class="flex flex-row px-2 border-b border-gray-200 w-full">
						<For each={items}>
							{(item) => (
								<Tabs.Trigger asChild value={item.href}>
									<As
										component={A}
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
									</As>
								</Tabs.Trigger>
							)}
						</For>
					</Tabs.List>
					<Tabs.Indicator class="absolute transition-all duration-200 bottom-0 flex flex-row px-2 h-[2px]">
						<div class="bg-brand flex-1 rounded-full" />
					</Tabs.Indicator>
				</Tabs.Root>
			)}
		</Show>
	);
}
