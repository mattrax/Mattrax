import {
	DropdownMenu as DropdownMenuPrimitive,
	type PolymorphicProps,
} from "@kobalte/core";
import type {
	ContextMenuCheckboxItemProps,
	ContextMenuGroupLabelProps,
	ContextMenuItemProps,
	ContextMenuRadioItemProps,
	ContextMenuSubContentProps,
} from "@kobalte/core/context-menu";
import type {
	DropdownMenuContentProps,
	DropdownMenuRootProps,
	DropdownMenuSubTriggerProps,
} from "@kobalte/core/dropdown-menu";
import type { SeparatorRootProps } from "@kobalte/core/separator";
import type { Component, ComponentProps, ValidComponent } from "solid-js";
import { createMemo, splitProps } from "solid-js";

import clsx from "clsx";
import {
	type Controller,
	ControllerProvider,
	createController,
} from "./lib/controller";

const DropdownMenu = <T extends ValidComponent = "div">(
	props: Omit<
		PolymorphicProps<T, DropdownMenuRootProps>,
		"open" | "setOpen" | "controller"
	> &
		(
			| { open: boolean; setOpen: (open: boolean) => void }
			| { controller?: Controller }
		),
) => {
	const _controller = createController();
	const controller = createMemo(() => {
		if ("controller" in props && props.controller)
			return props.controller as Controller;

		if ("open" in props && "setOpen" in props)
			return {
				get open() {
					return props.open;
				},
				get setOpen() {
					return props.setOpen;
				},
			} as Controller;

		return _controller;
	});

	const [, rest] = splitProps(props as any, ["open", "setOpen", "controller"]);

	return (
		<ControllerProvider value={controller()}>
			<DropdownMenuPrimitive.Root
				gutter={4}
				open={props.open || controller().open()}
				onOpenChange={(isOpen) => {
					controller().setOpen(isOpen);
				}}
				{...rest}
			/>
		</ControllerProvider>
	);
};

const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;

const DropdownMenuPortal = DropdownMenuPrimitive.Portal;

const DropdownMenuContent = <T extends ValidComponent = "div">(
	props: PolymorphicProps<T, DropdownMenuContentProps>,
) => {
	const [, rest] = splitProps(props as any, ["class"]);
	return (
		<DropdownMenuPrimitive.Portal>
			<DropdownMenuPrimitive.Content
				class={clsx(
					"bg-popover text-popover-foreground animate-content-hide data-[expanded]:animate-content-show z-50 min-w-[8rem] origin-[var(--kb-menu-content-transform-origin)] overflow-hidden rounded-md border p-1 shadow-md",
					props.class,
				)}
				{...rest}
			/>
		</DropdownMenuPrimitive.Portal>
	);
};

const DropdownMenuItem = <T extends ValidComponent = "div">(
	props: PolymorphicProps<T, ContextMenuItemProps>,
) => {
	const [, rest] = splitProps(props as any, ["class"]);
	return (
		<DropdownMenuPrimitive.Item
			class={clsx(
				"focus:bg-accent relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
				props.class,
			)}
			{...rest}
		/>
	);
};

const DropdownMenuShortcut = <T extends ValidComponent = "span">(
	props: ComponentProps<T>,
) => {
	const [, rest] = splitProps(props, ["class"]);
	return (
		<span
			class={clsx("ml-auto text-xs tracking-widest opacity-60", props.class)}
			{...rest}
		/>
	);
};

const DropdownMenuLabel: Component<
	ComponentProps<"div"> & { inset?: boolean }
> = (props) => {
	const [, rest] = splitProps(props, ["class", "inset"]);
	return (
		<div
			class={clsx(
				"px-2 py-1.5 text-sm font-semibold",
				props.inset && "pl-8",
				props.class,
			)}
			{...rest}
		/>
	);
};

const DropdownMenuSeparator = <T extends ValidComponent = "hr">(
	props: PolymorphicProps<T, SeparatorRootProps>,
) => {
	const [, rest] = splitProps(props as any, ["class"]);
	return (
		<DropdownMenuPrimitive.Separator
			class={clsx("bg-muted -mx-1 my-1 h-px", props.class)}
			{...rest}
		/>
	);
};

const DropdownMenuSub = DropdownMenuPrimitive.Sub;

const DropdownMenuSubTrigger = <T extends ValidComponent = "div">(
	props: PolymorphicProps<T, DropdownMenuSubTriggerProps>,
) => {
	const [, rest] = splitProps(props as any, ["class", "children"]);
	return (
		<DropdownMenuPrimitive.SubTrigger
			class={clsx(
				"focus:bg-accent data-[state=open]:bg-accent flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none",
				props.class,
			)}
			{...rest}
		>
			{props.children}
			<IconTablerChevronRight class="ml-auto h-4 w-4" />
		</DropdownMenuPrimitive.SubTrigger>
	);
};

const DropdownMenuSubContent = <T extends ValidComponent = "div">(
	props: PolymorphicProps<T, ContextMenuSubContentProps>,
) => {
	const [, rest] = splitProps(props as any, ["class"]);
	return (
		<DropdownMenuPrimitive.SubContent
			class={clsx(
				"bg-popover text-popover-foreground animate-in z-50 min-w-[8rem] origin-[var(--kb-menu-content-transform-origin)] overflow-hidden rounded-md border p-1 shadow-md",
				props.class,
			)}
			{...rest}
		/>
	);
};

const DropdownMenuCheckboxItem = <T extends ValidComponent = "div">(
	props: PolymorphicProps<T, ContextMenuCheckboxItemProps>,
) => {
	const [, rest] = splitProps(props as any, ["class", "children"]);
	return (
		<DropdownMenuPrimitive.CheckboxItem
			class={clsx(
				"focus:bg-accent focus:text-accent-foreground relative flex cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none transition-colors data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
				props.class,
			)}
			{...rest}
		>
			<span class="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
				<DropdownMenuPrimitive.ItemIndicator>
					<IconTablerCheck class="h-4 w-4" />
				</DropdownMenuPrimitive.ItemIndicator>
			</span>
			{props.children}
		</DropdownMenuPrimitive.CheckboxItem>
	);
};

const DropdownMenuGroup = DropdownMenuPrimitive.Group;

const DropdownMenuGroupLabel = <T extends ValidComponent = "span">(
	props: PolymorphicProps<T, ContextMenuGroupLabelProps>,
) => {
	const [, rest] = splitProps(props as any, ["class"]);
	return (
		<DropdownMenuPrimitive.GroupLabel
			class={clsx("px-2 py-1.5 text-sm font-semibold", props.class)}
			{...rest}
		/>
	);
};

const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup;

const DropdownMenuRadioItem = <T extends ValidComponent = "div">(
	props: PolymorphicProps<T, ContextMenuRadioItemProps>,
) => {
	const [local, rest] = splitProps(
		props as PolymorphicProps<"div", ContextMenuRadioItemProps>,
		["class", "children"],
	);
	return (
		<DropdownMenuPrimitive.RadioItem
			class={clsx(
				"focus:bg-accent focus:text-accent-foreground relative flex cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none transition-colors data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
				local.class,
			)}
			{...rest}
		>
			<span class="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
				<DropdownMenuPrimitive.ItemIndicator>
					<IconTablerCircle class="h-2 w-2 fill-current" />
				</DropdownMenuPrimitive.ItemIndicator>
			</span>
			{local.children}
		</DropdownMenuPrimitive.RadioItem>
	);
};

export {
	DropdownMenu,
	DropdownMenuTrigger,
	DropdownMenuPortal,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuShortcut,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubTrigger,
	DropdownMenuSubContent,
	DropdownMenuCheckboxItem,
	DropdownMenuGroup,
	DropdownMenuGroupLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
};
