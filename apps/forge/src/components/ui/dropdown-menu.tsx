import { DropdownMenu as DropdownMenuPrimitive } from "@kobalte/core";
import { TbCheck, TbChevronRight, TbCircle } from "solid-icons/tb";
import type { Component, ComponentProps } from "solid-js";
import { splitProps } from "solid-js";

import { cn } from "~/lib/utils";
import { Controller, ControllerProvider, createController } from "./controller";

// TODO: Making a trigger prop work is hard cause the element attributes don't get set
// // TODO: Build out a default setup
// const DropdownMenu: Component<
//   ParentProps<{
//     controller?: Controller;
//     trigger?: JSX.Element;
//   }>
// > = (props) => {
//   return (
//     <DropdownMenuRoot>
//       {props.trigger && (
//         <DropdownMenuTrigger as={() => props.trigger}>
//           {/* <As component={() => props.trigger} /> */}
//         </DropdownMenuTrigger>
//       )}

//       <DropdownMenuContent>
//         {props.children}
//         {/* TODO: From props */}
//         {/* <DropdownMenuLabel>My Account</DropdownMenuLabel>
//         <DropdownMenuSeparator />
//         <DropdownMenuItem>Profile</DropdownMenuItem>
//         <DropdownMenuItem>Billing</DropdownMenuItem>
//         <DropdownMenuItem>Team</DropdownMenuItem>
//         <DropdownMenuItem>Subscription</DropdownMenuItem> */}
//       </DropdownMenuContent>
//     </DropdownMenuRoot>
//   );
// };

const DropdownMenu: Component<
	Omit<DropdownMenuPrimitive.DropdownMenuRootProps, "open"> &
		(
			| {
					open: boolean;
					setOpen: (open: boolean) => void;
			  }
			| {
					controller?: Controller;
			  }
		)
> = (props) => {
	const controller =
		"controller" in props && props.controller
			? props.controller
			: createController();

	return (
		<ControllerProvider value={controller}>
			<DropdownMenuPrimitive.Root
				gutter={4}
				open={("open" in props ? props.open : false) || controller.open()}
				onOpenChange={(isOpen) => {
					if ("setOpen" in props) props.setOpen(isOpen);
					controller.setOpen(isOpen);
				}}
				{...props}
			/>
		</ControllerProvider>
	);
};

const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;

const DropdownMenuPortal = DropdownMenuPrimitive.Portal;

const DropdownMenuContent: Component<
	DropdownMenuPrimitive.DropdownMenuContentProps
> = (props) => {
	const [, rest] = splitProps(props, ["class"]);
	return (
		<DropdownMenuPrimitive.Portal>
			<DropdownMenuPrimitive.Content
				class={cn(
					"bg-popover text-popover-foreground animate-content-hide data-[expanded]:animate-content-show z-50 min-w-[8rem] origin-[var(--kb-menu-content-transform-origin)] overflow-hidden rounded-md border p-1 shadow-md",
					props.class,
				)}
				{...rest}
			/>
		</DropdownMenuPrimitive.Portal>
	);
};

const DropdownMenuItem: Component<DropdownMenuPrimitive.DropdownMenuItemProps> =
	(props) => {
		const [, rest] = splitProps(props, ["class"]);
		return (
			<DropdownMenuPrimitive.Item
				class={cn(
					"focus:bg-accent focus:text-accent-foreground relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
					props.class,
				)}
				{...rest}
			/>
		);
	};

const DropdownMenuShortcut: Component<ComponentProps<"span">> = (props) => {
	const [, rest] = splitProps(props, ["class"]);
	return (
		<span
			class={cn("ml-auto text-xs tracking-widest opacity-60", props.class)}
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
			class={cn(
				"px-2 py-1.5 text-sm font-semibold",
				props.inset && "pl-8",
				props.class,
			)}
			{...rest}
		/>
	);
};

const DropdownMenuSeparator: Component<
	DropdownMenuPrimitive.DropdownMenuSeparatorProps
> = (props) => {
	const [, rest] = splitProps(props, ["class"]);
	return (
		<DropdownMenuPrimitive.Separator
			class={cn("bg-muted -mx-1 my-1 h-px", props.class)}
			{...rest}
		/>
	);
};

const DropdownMenuSub = DropdownMenuPrimitive.Sub;

const DropdownMenuSubTrigger: Component<
	DropdownMenuPrimitive.DropdownMenuSubTriggerProps
> = (props) => {
	const [, rest] = splitProps(props, ["class", "children"]);
	return (
		<DropdownMenuPrimitive.SubTrigger
			class={cn(
				"focus:bg-accent data-[state=open]:bg-accent flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none",
				props.class,
			)}
			{...rest}
		>
			{props.children}
			<TbChevronRight class="ml-auto h-4 w-4" />
		</DropdownMenuPrimitive.SubTrigger>
	);
};

const DropdownMenuSubContent: Component<
	DropdownMenuPrimitive.DropdownMenuSubContentProps
> = (props) => {
	const [, rest] = splitProps(props, ["class"]);
	return (
		<DropdownMenuPrimitive.SubContent
			class={cn(
				"bg-popover text-popover-foreground animate-in z-50 min-w-[8rem] origin-[var(--kb-menu-content-transform-origin)] overflow-hidden rounded-md border p-1 shadow-md",
				props.class,
			)}
			{...rest}
		/>
	);
};

const DropdownMenuCheckboxItem: Component<
	DropdownMenuPrimitive.DropdownMenuCheckboxItemProps
> = (props) => {
	const [, rest] = splitProps(props, ["class", "children"]);
	return (
		<DropdownMenuPrimitive.CheckboxItem
			class={cn(
				"focus:bg-accent focus:text-accent-foreground relative flex cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none transition-colors data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
				props.class,
			)}
			{...rest}
		>
			<span class="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
				<DropdownMenuPrimitive.ItemIndicator>
					<TbCheck class="h-4 w-4" />
				</DropdownMenuPrimitive.ItemIndicator>
			</span>
			{props.children}
		</DropdownMenuPrimitive.CheckboxItem>
	);
};

const DropdownMenuGroup = DropdownMenuPrimitive.Group;

const DropdownMenuGroupLabel: Component<
	DropdownMenuPrimitive.DropdownMenuGroupLabelProps
> = (props) => {
	const [, rest] = splitProps(props, ["class"]);
	return (
		<DropdownMenuPrimitive.GroupLabel
			class={cn("px-2 py-1.5 text-sm font-semibold", props.class)}
			{...rest}
		/>
	);
};

const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup;

const DropdownMenuRadioItem: Component<
	DropdownMenuPrimitive.DropdownMenuRadioItemProps
> = (props) => {
	const [, rest] = splitProps(props, ["class", "children"]);
	return (
		<DropdownMenuPrimitive.RadioItem
			class={cn(
				"focus:bg-accent focus:text-accent-foreground relative flex cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none transition-colors data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
				props.class,
			)}
			{...rest}
		>
			<span class="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
				<DropdownMenuPrimitive.ItemIndicator>
					<TbCircle class="h-2 w-2 fill-current" />
				</DropdownMenuPrimitive.ItemIndicator>
			</span>
			{props.children}
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
