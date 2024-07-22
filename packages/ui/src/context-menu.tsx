import type { Component, ComponentProps, ValidComponent } from "solid-js";
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

import clsx from "clsx";

const ContextMenu: Component<ContextMenuPrimitive.ContextMenuRootProps> = (
	props,
) => {
	return <ContextMenuPrimitive.Root gutter={4} {...props} />;
};

const ContextMenuTrigger = ContextMenuPrimitive.Trigger;

const ContextMenuPortal = ContextMenuPrimitive.Portal;

const ContextMenuContent = <T extends ValidComponent = "div">(
	props: PolymorphicProps<T, ContextMenuContentProps>,
) => {
	const [, rest] = splitProps(props as any, ["class"]);
	return (
		<ContextMenuPrimitive.Portal>
			<ContextMenuPrimitive.Content
				class={clsx(
					"z-50 min-w-32 origin-[var(--kb-menu-content-transform-origin)] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md animate-in",
					props.class,
				)}
				{...rest}
			/>
		</ContextMenuPrimitive.Portal>
	);
};

const ContextMenuItem = <T extends ValidComponent = "div">(
	props: PolymorphicProps<T, ContextMenuItemProps>,
) => {
	const [, rest] = splitProps(props as any, ["class"]);
	return (
		<ContextMenuPrimitive.Item
			class={clsx(
				"relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
				props.class,
			)}
			{...rest}
		/>
	);
};

const ContextMenuShortcut = <T extends ValidComponent = "span">(
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

const ContextMenuSeparator = <T extends ValidComponent = "hr">(
	props: PolymorphicProps<T, SeparatorRootProps>,
) => {
	const [, rest] = splitProps(props as any, ["class"]);
	return (
		<ContextMenuPrimitive.Separator
			class={clsx("-mx-1 my-1 h-px bg-muted", props.class)}
			{...rest}
		/>
	);
};

const ContextMenuSub = ContextMenuPrimitive.Sub;

const ContextMenuSubTrigger = <T extends ValidComponent = "div">(
	props: PolymorphicProps<T, ContextMenuSubTriggerProps>,
) => {
	const [, rest] = splitProps(props as any, ["class", "children"]);
	return (
		<ContextMenuPrimitive.SubTrigger
			class={clsx(
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
				aria-hidden="true"
			>
				<path d="M9 6l6 6l-6 6" />
			</svg>
		</ContextMenuPrimitive.SubTrigger>
	);
};

const ContextMenuSubContent = <T extends ValidComponent = "div">(
	props: PolymorphicProps<T, ContextMenuSubContentProps>,
) => {
	const [, rest] = splitProps(props as any, ["class"]);
	return (
		<ContextMenuPrimitive.SubContent
			class={clsx(
				"z-50 min-w-32 origin-[var(--kb-menu-content-transform-origin)] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md animate-in",
				props.class,
			)}
			{...rest}
		/>
	);
};

const ContextMenuCheckboxItem = <T extends ValidComponent = "div">(
	props: PolymorphicProps<T, ContextMenuCheckboxItemProps>,
) => {
	const [, rest] = splitProps(props as any, ["class", "children"]);
	return (
		<ContextMenuPrimitive.CheckboxItem
			class={clsx(
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
						aria-hidden="true"
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

const ContextMenuGroupLabel = <T extends ValidComponent = "span">(
	props: PolymorphicProps<T, ContextMenuGroupLabelProps>,
) => {
	const [, rest] = splitProps(props as any, ["class"]);
	return (
		<ContextMenuPrimitive.GroupLabel
			class={clsx("px-2 py-1.5 text-sm font-semibold", props.class)}
			{...rest}
		/>
	);
};

const ContextMenuRadioGroup = ContextMenuPrimitive.RadioGroup;

const ContextMenuRadioItem = <T extends ValidComponent = "div">(
	props: PolymorphicProps<T, ContextMenuRadioItemProps>,
) => {
	const [local, rest] = splitProps(
		props as PolymorphicProps<"div", ContextMenuRadioItemProps>,
		["class", "children"],
	);

	return (
		<ContextMenuPrimitive.RadioItem
			class={clsx(
				"relative flex cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
				local.class,
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
						aria-hidden="true"
					>
						<path d="M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0" />
					</svg>
				</ContextMenuPrimitive.ItemIndicator>
			</span>
			{local.children}
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
