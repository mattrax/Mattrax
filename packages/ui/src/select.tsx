import {
	type PolymorphicProps,
	Select as SelectPrimitive,
} from "@kobalte/core";
import type { Component } from "solid-js";
import { splitProps } from "solid-js";

import type { ListboxItemProps } from "@kobalte/core/listbox";
import type {
	SelectContentProps,
	SelectTriggerProps,
} from "@kobalte/core/select";
import { cn } from "./lib";

const Select = SelectPrimitive.Root;

const SelectValue = SelectPrimitive.Value;

const SelectTrigger: Component<PolymorphicProps<"button", SelectTriggerProps>> =
	(props) => {
		const [, rest] = splitProps(props, ["class", "children"]);
		return (
			<SelectPrimitive.Trigger
				class={cn(
					"border-input ring-offset-background placeholder:text-muted-foreground focus:ring-ring flex h-10 w-full items-center justify-between rounded-md border bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
					props.class,
				)}
				{...rest}
			>
				{props.children}
				<SelectPrimitive.Icon>
					<IconTablerChevronDown class="h-4 w-4 opacity-50" />
				</SelectPrimitive.Icon>
			</SelectPrimitive.Trigger>
		);
	};

const SelectContent: Component<PolymorphicProps<"div", SelectContentProps>> = (
	props,
) => {
	const [, rest] = splitProps(props, ["class"]);
	return (
		<SelectPrimitive.Portal>
			<SelectPrimitive.Content
				class={cn(
					"bg-popover text-popover-foreground relative z-50 min-w-[8rem] overflow-hidden rounded-md border shadow-md",
					"ui-expanded:animate-in ui-expanded:fade-in-0 ui-expanded:slide-in-from-top-2",
					"ui-closed:animate-out ui-closed:fade-out-0 ui-closed:slide-out-to-top-2",
					props.class,
				)}
				{...rest}
			>
				<SelectPrimitive.Listbox class="m-0 p-1" />
			</SelectPrimitive.Content>
		</SelectPrimitive.Portal>
	);
};

const SelectItem: Component<PolymorphicProps<"li", ListboxItemProps>> = (
	props,
) => {
	const [, rest] = splitProps(props, ["class", "children"]);
	return (
		<SelectPrimitive.Item
			class={cn(
				"focus:bg-accent focus:text-accent-foreground relative mt-0 flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
				props.class,
			)}
			{...rest}
		>
			<span class="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
				<SelectPrimitive.ItemIndicator>
					<IconTablerCheck class="h-4 w-4" />
				</SelectPrimitive.ItemIndicator>
			</span>
			<SelectPrimitive.ItemLabel>{props.children}</SelectPrimitive.ItemLabel>
		</SelectPrimitive.Item>
	);
};

export { Select, SelectValue, SelectTrigger, SelectContent, SelectItem };
