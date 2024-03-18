// From TailwindUI not ShadCN

import { A } from "@solidjs/router";
import { For } from "solid-js";

function classNames(...classes: (string | boolean | undefined | null)[]) {
	return classes.filter(Boolean).join(" ");
}

export default function FlatTabs(props: {
	tabs: { name: string; href: string; current: boolean }[];
}) {
	return (
		<div>
			<div class="sm:hidden">
				<label for="tabs" class="sr-only">
					Select a tab
				</label>
				{/* Use an "onChange" listener to redirect the user to the selected tab URL. */}
				<select
					id="tabs"
					name="tabs"
					class="block w-full rounded-md border-gray-300 py-2 pl-3 pr-10 text-base focus:border-indigo-500 focus:outline-none focus:ring-indigo-500 sm:text-sm"
					// defaultValue={props.tabs.find((tab) => tab.current)?.name}
				>
					<For each={props.tabs}>{(tab) => <option>{tab.name}</option>}</For>
				</select>
			</div>
			<div class="hidden sm:block">
				<div class="border-b border-gray-200">
					<nav class="-mb-px flex space-x-8" aria-label="Tabs">
						<For each={props.tabs}>
							{(tab) => (
								<A
									end
									href={tab.href}
									class={classNames(
										// tab.current
										//   ? "border-indigo-500 text-indigo-600"
										//   : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700",
										"whitespace-nowrap border-b-2 py-4 px-1 text-sm font-medium",
									)}
									activeClass="border-indigo-500 text-indigo-600"
									inactiveClass="border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700"
									aria-current={tab.current ? "page" : undefined}
								>
									{tab.name}
								</A>
							)}
						</For>
					</nav>
				</div>
			</div>
		</div>
	);
}
