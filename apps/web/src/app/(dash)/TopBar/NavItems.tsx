import { As, Tabs } from "@kobalte/core";
import { createContextProvider } from "@solid-primitives/context";
import { A, useMatch, useMatches, useResolvedPath } from "@solidjs/router";
import {
	type Accessor,
	For,
	Show,
	createMemo,
	onCleanup,
} from "solid-js";
import { createStore, produce } from "solid-js/store";

export type NavItemConfig = {
	title: string;
	href: string;
};

export const [NavItemsProvider, useNavItemsContext] = createContextProvider(
	() => {
		const matches = useMatches();

		const route = createMemo(() => {
			const m = matches();
			m.reverse();

			return m.find((m) => Array.isArray(m.route.info?.NAV_ITEMS));
		});

		const items = createMemo(() => {
			const r = route();
			if (!r) return;

			return {
				items: r.route.info?.NAV_ITEMS as Array<NavItemConfig>,
				prefix: () => r.path,
			};
		});

		return { items: items };
	},
	null!,
);

export function NavItems() {
	const { items } = useNavItemsContext();

	return (
		<Show when={items()} keyed>
			{(entry) => (
				<Tabs.Root
					as="nav"
					// value={entry.value()}
					class="text-white sticky top-0 border-b border-gray-200 z-10 bg-white -mt-2 overflow-x-auto scrollbar-none shrink-0 flex flex-row"
				>
					<Tabs.List class="flex flex-row px-2">
						<For each={entry.items}>
							{(item) => (
								<Tabs.Trigger asChild value={item.href}>
									<As
										component={A}
										end={item.href === ""}
										href={
											item.href === ""
												? entry.prefix()
												: `${entry.prefix()}/${item.href}`
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
					<Tabs.Indicator class="absolute transition-all duration-200 -bottom-px flex flex-row px-2 h-[2px]">
						<div class="bg-brand flex-1" />
					</Tabs.Indicator>
				</Tabs.Root>
			)}
		</Show>
	);
}
