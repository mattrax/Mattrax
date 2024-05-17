import type { Component, ComponentProps } from "solid-js";
import { splitProps } from "solid-js";

import {
	ContextMenu as ContextMenuPrimitive,
	type PolymorphicProps,
} from "@kobalte/core";
import type {
	ContextMenuCheckboxItemProps,
	ContextMenuContentProps,
	ContextMenuGroupLabelProps,
	ContextMenuRadioItemProps,
	ContextMenuSubContentProps,
	ContextMenuSubTriggerProps,
} from "@kobalte/core/context-menu";
import type { ContextMenuItemProps } from "@kobalte/core/context-menu";
import type { SeparatorRootProps } from "@kobalte/core/separator";

import { cn } from "./lib";

const ContextMenu: Component<ContextMenuPrimitive.ContextMenuRootProps> = (
	props,
) => {
	return <ContextMenuPrimitive.Root gutter={4} {...props} />;
};

const ContextMenuTrigger = ContextMenuPrimitive.Trigger;

const ContextMenuPortal = ContextMenuPrimitive.Portal;

const ContextMenuContent: Component<
	PolymorphicProps<"div", ContextMenuContentProps>
> = (props) => {
	const [, rest] = splitProps(props, ["class"]);
	return (
		<ContextMenuPrimitive.Portal>
			<ContextMenuPrimitive.Content
				class={cn(
					"z-50 min-w-32 origin-[var(--kb-menu-content-transform-origin)] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md animate-in",
					props.class,
				)}
				{...rest}
			/>
		</ContextMenuPrimitive.Portal>
	);
};

const ContextMenuItem: Component<
	PolymorphicProps<"div", ContextMenuItemProps>
> = (props) => {
	const [, rest] = splitProps(props, ["class"]);
	return (
		<ContextMenuPrimitive.Item
			class={cn(
				"relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
				props.class,
			)}
			{...rest}
		/>
	);
};

const ContextMenuShortcut: Component<ComponentProps<"span">> = (props) => {
	const [, rest] = splitProps(props, ["class"]);
	return (
		<span
			class={cn("ml-auto text-xs tracking-widest opacity-60", props.class)}
			{...rest}
		/>
	);
};

const ContextMenuSeparator: Component<
	PolymorphicProps<"hr", SeparatorRootProps>
> = (props) => {
	const [, rest] = splitProps(props, ["class"]);
	return (
		<ContextMenuPrimitive.Separator
			class={cn("-mx-1 my-1 h-px bg-muted", props.class)}
			{...rest}
		/>
	);
};

const ContextMenuSub = ContextMenuPrimitive.Sub;

const ContextMenuSubTrigger: Component<
	PolymorphicProps<"div", ContextMenuSubTriggerProps>
> = (props) => {
	const [, rest] = splitProps(props, ["class", "children"]);
	return (
		<ContextMenuPrimitive.SubTrigger
			class={cn(
				"flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none focus:bg-accent data-[state=open]:bg-accent",
				props.class,
			)}
			{...rest}
		>
			{props.children}
			<svg
				xmlns="http://www.w3.org/2000/svg"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
				class="ml-auto size-4"
			>
				<path d="M9 6l6 6l-6 6" />
			</svg>
		</ContextMenuPrimitive.SubTrigger>
	);
};

const ContextMenuSubContent: Component<
	PolymorphicProps<"div", ContextMenuSubContentProps>
> = (props) => {
	const [, rest] = splitProps(props, ["class"]);
	return (
		<ContextMenuPrimitive.SubContent
			class={cn(
				"z-50 min-w-32 origin-[var(--kb-menu-content-transform-origin)] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md animate-in",
				props.class,
			)}
			{...rest}
		/>
	);
};

const ContextMenuCheckboxItem: Component<
	PolymorphicProps<"div", ContextMenuCheckboxItemProps>
> = (props) => {
	const [, rest] = splitProps(props, ["class", "children"]);
	return (
		<ContextMenuPrimitive.CheckboxItem
			class={cn(
				"relative flex cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
				props.class,
			)}
			{...rest}
		>
			<span class="absolute left-2 flex size-3.5 items-center justify-center">
				<ContextMenuPrimitive.ItemIndicator>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						class="size-4"
					>
						<path d="M5 12l5 5l10 -10" />
					</svg>
				</ContextMenuPrimitive.ItemIndicator>
			</span>
			{props.children}
		</ContextMenuPrimitive.CheckboxItem>
	);
};

const ContextMenuGroup = ContextMenuPrimitive.Group;

const ContextMenuGroupLabel: Component<
	PolymorphicProps<"span", ContextMenuGroupLabelProps>
> = (props) => {
	const [, rest] = splitProps(props, ["class"]);
	return (
		<ContextMenuPrimitive.GroupLabel
			class={cn("px-2 py-1.5 text-sm font-semibold", props.class)}
			{...rest}
		/>
	);
};

const ContextMenuRadioGroup = ContextMenuPrimitive.RadioGroup;

const ContextMenuRadioItem: Component<
	PolymorphicProps<"div", ContextMenuRadioItemProps>
> = (props) => {
	const [, rest] = splitProps(props, ["class", "children"]);
	return (
		<ContextMenuPrimitive.RadioItem
			class={cn(
				"relative flex cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
				props.class,
			)}
			{...rest}
		>
			<span class="absolute left-2 flex size-3.5 items-center justify-center">
				<ContextMenuPrimitive.ItemIndicator>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						class="size-2 fill-current"
					>
						<path d="M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0" />
					</svg>
				</ContextMenuPrimitive.ItemIndicator>
			</span>
			{props.children}
		</ContextMenuPrimitive.RadioItem>
	);
};

export {
	ContextMenu,
	ContextMenuTrigger,
	ContextMenuPortal,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuShortcut,
	ContextMenuSeparator,
	ContextMenuSub,
	ContextMenuSubTrigger,
	ContextMenuSubContent,
	ContextMenuCheckboxItem,
	ContextMenuGroup,
	ContextMenuGroupLabel,
	ContextMenuRadioGroup,
	ContextMenuRadioItem,
};
