import type { ComponentProps, ValidComponent, VoidProps } from "solid-js";
import { splitProps } from "solid-js";

import {
	Combobox as ComboboxPrimitive,
	type PolymorphicProps,
} from "@kobalte/core";
import type {
	ComboboxInputProps,
	ComboboxListboxProps,
	ComboboxRootProps,
} from "@kobalte/core/combobox";
import type { DialogRootProps } from "@kobalte/core/dialog";
import type {
	ListboxItemProps,
	ListboxSectionProps,
} from "@kobalte/core/listbox";

import { Dialog, DialogContent } from "./dialog";
import { cn } from "./lib";

type CommandProps<Option, OptGroup> = Omit<
	ComboboxPrimitive.ComboboxRootProps<Option, OptGroup>,
	| "open"
	| "defaultOpen"
	| "multiple"
	// | "value"
	| "defaultValue"
	| "removeOnBackspace"
	| "readOnly"
	| "allowsEmptyCollection"
>;

const Command = <Option, OptGroup = never, T extends ValidComponent = "div">(
	props: PolymorphicProps<T, ComboboxRootProps<Option, OptGroup>>,
) => {
	const [local, rest] = splitProps(props as any, ["class"]);

	return (
		<ComboboxPrimitive.Root<Option, OptGroup>
			// force render list
			open
			// @ts-ignore -- prevent select
			value=""
			allowsEmptyCollection
			class={cn(
				"flex flex-col overflow-hidden rounded-md bg-popover text-popover-foreground",
				local.class,
			)}
			{...rest}
		/>
	);
};

const CommandInput = <T extends ValidComponent = "input">(
	props: PolymorphicProps<T, ComboboxInputProps>,
) => {
	const [local, rest] = splitProps(props as any, ["class"]);

	return (
		<ComboboxPrimitive.Control
			class="flex items-center border-b px-3"
			cmdk-input-wrapper=""
		>
			<IconPhMagnifyingGlassLight class="mr-2 size-4 shrink-0 opacity-50" />
			<ComboboxPrimitive.Input
				cmdk-input=""
				class={cn(
					"flex h-10 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50",
					local.class,
				)}
				{...rest}
			/>
		</ComboboxPrimitive.Control>
	);
};

const CommandList = <Option, OptGroup, T extends ValidComponent = "ul">(
	props: VoidProps<PolymorphicProps<T, ComboboxListboxProps<Option, OptGroup>>>,
) => {
	const [local, rest] = splitProps(props as any, ["class"]);

	return (
		<ComboboxPrimitive.Listbox
			cmdk-list=""
			class={cn(
				"max-h-[300px] overflow-y-auto overflow-x-hidden p-1",
				local.class,
			)}
			{...rest}
		/>
	);
};

const CommandItem = <T extends ValidComponent = "li">(
	props: PolymorphicProps<T, ListboxItemProps>,
) => {
	const [local, rest] = splitProps(props as any, ["class", "item"]);

	return (
		<ComboboxPrimitive.Item
			item={local.item}
			cmdk-item=""
			class={cn(
				"relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none data-[disabled]:pointer-events-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:opacity-50",
				local.class,
			)}
			{...rest}
		/>
	);
};

const CommandItemLabel = ComboboxPrimitive.ItemLabel;

const CommandHeading = <T extends ValidComponent = "li">(
	props: PolymorphicProps<T, ListboxSectionProps>,
) => {
	const [local, rest] = splitProps(props as any, ["class"]);

	return (
		<ComboboxPrimitive.Section
			cmdk-heading=""
			class={cn(
				"px-2 py-1.5 text-xs font-medium text-muted-foreground [&:not(&:first-of-type)]:mt-2",
				local.class,
			)}
			{...rest}
		/>
	);
};

const CommandItemShortcut = <T extends ValidComponent = "span">(
	props: ComponentProps<T>,
) => {
	const [local, rest] = splitProps(props as any, ["class"]);

	return (
		<span
			class={cn(
				"ml-auto text-xs tracking-widest text-muted-foreground",
				local.class,
			)}
			{...rest}
		/>
	);
};

const CommandDialog = <
	Option,
	OptGroup = never,
	T extends ValidComponent = "div",
>(
	props: DialogRootProps &
		PolymorphicProps<T, ComboboxRootProps<Option, OptGroup>>,
) => {
	const [local, rest] = splitProps(props, ["children"]);

	return (
		<Dialog {...rest}>
			<DialogContent class="overflow-hidden p-0">
				<Command
					class="[&_[cmdk-heading]]:px-2 [&_[cmdk-heading]]:font-medium [&_[cmdk-heading]]:text-muted-foreground [&_[cmdk-input-wrapper]_svg]:size-5 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-3 [&_[cmdk-item]_svg]:size-5 [&_[cmdk-list]:not([hidden])_~[cmdk-list]]:pt-0 [&_[cmdk-list]]:px-2"
					{...rest}
				>
					{local.children}
				</Command>
			</DialogContent>
		</Dialog>
	);
};

export {
	Command,
	CommandInput,
	CommandList,
	CommandItem,
	CommandItemLabel,
	CommandItemShortcut,
	CommandHeading,
	CommandDialog,
};
