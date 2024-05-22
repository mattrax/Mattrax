import { Tabs } from "@kobalte/core";
import { A, useMatch } from "@solidjs/router";
import { For, type ParentProps, Show, children } from "solid-js";

export default function (props: ParentProps) {
	const items = children(() => props.children) as unknown as () =>
		| [{ items: { title: string; href: string }[]; base(): string }]
		| undefined;

	return (
		<Show when={items()?.[0]}>
			{(items) => {
				const prefix = () => items().base();

				const match = useMatch(() => `${prefix()}/:value/*rest`);

				const value = () => match()?.params.value ?? "";

				return (
					<Tabs.Root
						as="nav"
						value={`${prefix()}/${value()}`}
						class="bg-white text-white sticky top-0 z-40 bg-white -mt-2 overflow-x-auto scrollbar-none shrink-0 flex flex-row"
					>
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
						<Tabs.Indicator class="absolute transition-all duration-200 bottom-0 flex flex-row px-2 h-[2px]">
							<div class="bg-brand flex-1 rounded-full" />
						</Tabs.Indicator>
					</Tabs.Root>
				);
			}}
		</Show>
	);
}
