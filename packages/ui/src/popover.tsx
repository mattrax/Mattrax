import type { Component, ValidComponent } from "solid-js";
import { splitProps } from "solid-js";

import {
	type PolymorphicProps,
	Popover as PopoverPrimitive,
} from "@kobalte/core";
import type { PopoverContentProps } from "@kobalte/core/popover";

import clsx from "clsx";
import {
	type Controller,
	ControllerProvider,
	createController,
} from "./lib/controller";

const Popover: Component<
	Omit<PopoverPrimitive.PopoverRootProps, "open"> &
		(
			| { open: boolean; setOpen: (open: boolean) => void }
			| { controller?: Controller }
		)
> = (props) => {
	const controller =
		"controller" in props && props.controller !== undefined
			? props.controller
			: createController();

	return (
		<ControllerProvider value={controller}>
			<PopoverPrimitive.Root
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

const PopoverTrigger = PopoverPrimitive.Trigger;

const PopoverContent = <T extends ValidComponent = "div">(
	props: PolymorphicProps<T, PopoverContentProps>,
) => {
	const [, rest] = splitProps(props as any, ["class"]);
	return (
		<PopoverPrimitive.Portal>
			<PopoverPrimitive.Content
				class={clsx(
					"z-50 origin-[var(--kb-popover-content-transform-origin)] rounded-md border overflow-hidden bg-popover text-popover-foreground shadow-md outline-none data-[expanded]:animate-in data-[closed]:animate-out data-[closed]:fade-out-0 data-[expanded]:fade-in-0 data-[closed]:zoom-out-95 data-[expanded]:zoom-in-95",
					props.class,
				)}
				{...rest}
			/>
		</PopoverPrimitive.Portal>
	);
};

export { Popover, PopoverTrigger, PopoverContent };
