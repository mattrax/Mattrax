import type { Component } from "solid-js";
import { splitProps } from "solid-js";

import {
	Combobox as ComboboxPrimitive,
	type PolymorphicProps,
} from "@kobalte/core";
import type { ListboxSectionProps } from "@kobalte/core/listbox";
import type {
	ListboxItemIndicatorProps,
	ListboxItemProps,
} from "@kobalte/core/listbox";

import { cn } from "./lib";
import type {
	ComboboxContentProps,
	ComboboxControlProps,
	ComboboxInputProps,
	ComboboxTriggerProps,
} from "@kobalte/core/combobox";

const ComboboxRoot = ComboboxPrimitive.Root;

const ComboboxItem: Component<PolymorphicProps<"li", ListboxItemProps>> = (
	props,
) => {
	const [, rest] = splitProps(props, ["class"]);
	return (
		<ComboboxPrimitive.Item
			class={cn(
				"relative flex cursor-default select-none items-center justify-between rounded-sm px-2 py-1.5 text-sm outline-none data-[disabled]:pointer-events-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:opacity-50",
				props.class,
			)}
			{...rest}
		/>
	);
};

const ComboboxItemLabel = ComboboxPrimitive.ItemLabel;

const ComboboxItemIndicator: Component<
	PolymorphicProps<"div", ListboxItemIndicatorProps>
> = (props) => {
	const [, rest] = splitProps(props, ["children"]);
	return (
		<ComboboxPrimitive.ItemIndicator {...rest}>
			{props.children ?? <IconPhCheck />}
		</ComboboxPrimitive.ItemIndicator>
	);
};

const ComboboxSection: Component<PolymorphicProps<"li", ListboxSectionProps>> =
	(props) => {
		const [, rest] = splitProps(props, ["class"]);
		return (
			<ComboboxPrimitive.Section
				class={cn(
					"overflow-hidden p-1 px-2 py-1.5 text-xs font-medium text-muted-foreground ",
					props.class,
				)}
				{...rest}
			/>
		);
	};

// due to the generic typing this needs to be a function
function ComboboxControl<Option>(
	props: PolymorphicProps<"div", ComboboxControlProps<Option>>,
) {
	const [, rest] = splitProps(props, ["class"]);
	return (
		<ComboboxPrimitive.Control
			class={cn("flex items-center rounded-md border px-3", props.class)}
			{...rest}
		/>
	);
}

const ComboboxInput: Component<PolymorphicProps<"input", ComboboxInputProps>> =
	(props) => {
		const [, rest] = splitProps(props, ["class"]);
		return (
			<ComboboxPrimitive.Input
				class={cn(
					"flex h-10 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50",
					props.class,
				)}
				{...rest}
			/>
		);
	};

const ComboboxHiddenSelect = ComboboxPrimitive.HiddenSelect;

const ComboboxTrigger: Component<
	PolymorphicProps<"button", ComboboxTriggerProps>
> = (props) => {
	const [, rest] = splitProps(props, ["class", "children"]);
	return (
		<ComboboxPrimitive.Trigger
			class={cn("size-4 opacity-50", props.class)}
			{...rest}
		>
			<ComboboxPrimitive.Icon>
				{props.children ?? <IconTablerSelector />}
			</ComboboxPrimitive.Icon>
		</ComboboxPrimitive.Trigger>
	);
};

const ComboboxContent: Component<
	PolymorphicProps<"div", ComboboxContentProps>
> = (props) => {
	const [, rest] = splitProps(props, ["class"]);
	return (
		<ComboboxPrimitive.Portal>
			<ComboboxPrimitive.Content
				class={cn(
					"relative z-50 min-w-[8rem] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md animate-in fade-in-80",
					props.class,
				)}
				{...rest}
			>
				<ComboboxPrimitive.Listbox class="m-0 p-1" />
			</ComboboxPrimitive.Content>
		</ComboboxPrimitive.Portal>
	);
};

export {
	ComboboxRoot,
	ComboboxItem,
	ComboboxItemLabel,
	ComboboxItemIndicator,
	ComboboxSection,
	ComboboxControl,
	ComboboxTrigger,
	ComboboxInput,
	ComboboxHiddenSelect,
	ComboboxContent,
};
