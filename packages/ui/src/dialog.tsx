import {
	Dialog as DialogPrimitive,
	type PolymorphicProps,
} from "@kobalte/core";
import type { Component, ComponentProps, ValidComponent } from "solid-js";
import { splitProps } from "solid-js";
import type {
	DialogContentProps,
	DialogDescriptionProps,
	DialogOverlayProps,
	DialogPortalProps,
	DialogRootProps,
	DialogTitleProps,
	DialogTriggerProps,
} from "@kobalte/core/dialog";

import { cn } from "./lib";
import {
	type Controller,
	ControllerProvider,
	createController,
} from "./controller";

const Dialog: Component<
	Omit<DialogRootProps, "open"> &
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
			<DialogPrimitive.Root
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

const DialogTrigger = <T extends ValidComponent = "button">(
	props: PolymorphicProps<T, DialogTriggerProps>,
) => {
	return <DialogPrimitive.Trigger {...props} />;
};

const DialogPortal: Component<DialogPortalProps> = (props) => {
	const [, rest] = splitProps(props, ["children"]);
	return (
		<DialogPrimitive.Portal {...rest}>
			<div class="fixed inset-0 z-50 flex items-start justify-center sm:items-center">
				{props.children}
			</div>
		</DialogPrimitive.Portal>
	);
};

const DialogOverlay = <T extends ValidComponent = "div">(
	props: PolymorphicProps<T, DialogOverlayProps>,
) => {
	const [, rest] = splitProps(props as any, ["class"]);
	return (
		<DialogPrimitive.Overlay
			class={cn(
				"bg-background/60 data-[expanded]:animate-in data-[closed]:animate-out data-[closed]:fade-out-0 data-[expanded]:fade-in-0 fixed inset-0 z-50 backdrop-blur-[2px]",
				props.class,
			)}
			{...rest}
		/>
	);
};

const DialogContent = <T extends ValidComponent = "div">(
	props: PolymorphicProps<T, DialogContentProps>,
) => {
	const [, rest] = splitProps(props as any, ["class", "children"]);
	return (
		<DialogPortal>
			<DialogOverlay />
			<DialogPrimitive.Content
				class={cn(
					"bg-background data-[expanded]:animate-in data-[closed]:animate-out data-[closed]:fade-out-0 data-[expanded]:fade-in-0 data-[closed]:zoom-out-95 data-[expanded]:zoom-in-95 data-[closed]:slide-out-to-left-1/2 data-[closed]:slide-out-to-top-[48%] data-[expanded]:slide-in-from-left-1/2 data-[expanded]:slide-in-from-top-[48%] fixed left-[50%] top-[50%] z-50 grid translate-x-[-50%] translate-y-[-50%] gap-4 border p-6 shadow-lg duration-200 sm:rounded-lg",
					props.class,
				)}
				{...rest}
			>
				{props.children}
				<DialogPrimitive.CloseButton class="ring-offset-background focus:ring-ring data-[expanded]:bg-accent data-[expanded]:text-muted-foreground absolute right-4 top-4 rounded-sm opacity-70 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:pointer-events-none">
					<IconTablerX class="h-4 w-4" />
					<span class="sr-only">Close</span>
				</DialogPrimitive.CloseButton>
			</DialogPrimitive.Content>
		</DialogPortal>
	);
};

const DialogHeader: Component<ComponentProps<"div">> = (props) => {
	const [, rest] = splitProps(props, ["class"]);
	return (
		<div
			class={cn(
				"flex flex-col space-y-1.5 text-center sm:text-left",
				props.class,
			)}
			{...rest}
		/>
	);
};

const DialogFooter: Component<ComponentProps<"div">> = (props) => {
	const [, rest] = splitProps(props, ["class"]);
	return (
		<div
			class={cn(
				"flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
				props.class,
			)}
			{...rest}
		/>
	);
};

const DialogTitle = <T extends ValidComponent = "h2">(
	props: PolymorphicProps<T, DialogTitleProps>,
) => {
	const [, rest] = splitProps(props as any, ["class"]);
	return (
		<DialogPrimitive.Title
			class={cn(
				"text-lg font-semibold leading-none tracking-tight",
				props.class,
			)}
			{...rest}
		/>
	);
};

const DialogDescription = <T extends ValidComponent = "p">(
	props: PolymorphicProps<T, DialogDescriptionProps>,
) => {
	const [, rest] = splitProps(props as any, ["class"]);
	return (
		<DialogPrimitive.Description
			class={cn("text-muted-foreground text-sm", props.class)}
			{...rest}
		/>
	);
};

export {
	Dialog,
	Dialog as DialogRoot,
	DialogTrigger,
	DialogContent,
	DialogHeader,
	DialogFooter,
	DialogTitle,
	DialogDescription,
};
