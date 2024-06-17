import {
	Dialog as DialogPrimitive,
	type PolymorphicProps,
} from "@kobalte/core";
import type {
	DialogContentProps,
	DialogDescriptionProps,
	DialogOverlayProps,
	DialogPortalProps,
	DialogRootProps,
	DialogTitleProps,
	DialogTriggerProps,
} from "@kobalte/core/dialog";
import type { Component, ComponentProps, ValidComponent } from "solid-js";
import { Show, splitProps } from "solid-js";

import clsx from "clsx";
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
			: createController(props.defaultOpen);

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
	props: PolymorphicProps<T, DialogTriggerProps<T>>,
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
			class={clsx(
				"bg-background/60 data-[expanded]:animate-in data-[closed]:animate-out data-[closed]:fade-out-0 data-[expanded]:fade-in-0 fixed inset-0 z-50 backdrop-blur-[2px]",
				props.class,
			)}
			{...rest}
		/>
	);
};

const DialogContent = <T extends ValidComponent = "div">(
	props: PolymorphicProps<T, DialogContentProps> & {
		closeButton?: boolean;
		positionClass?: string;
	},
) => {
	const [, rest] = splitProps(props as any, [
		"class",
		"children",
		"closeButton",
		"positionClass",
	]);
	return (
		<DialogPortal>
			<DialogOverlay />
			{/* We apply position to a different element than the animation so the translate isn't applied to the animation */}
			<div
				class={clsx(
					"fixed w-full z-50",
					props.positionClass ??
						"left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2",
				)}
			>
				<DialogPrimitive.Content
					class={clsx(
						"relative grid mx-auto max-w-lg gap-4 border bg-background p-6 shadow-lg duration-200 data-[expanded]:animate-in data-[closed]:animate-out data-[closed]:fade-out-0 data-[expanded]:fade-in-0 data-[closed]:zoom-out-95 data-[expanded]:zoom-in-95 sm:rounded-lg",
						props.class,
					)}
					{...rest}
				>
					{props.children}
					<Show when={props.closeButton !== false}>
						<DialogPrimitive.CloseButton class="ring-offset-background focus:ring-ring data-[expanded]:bg-accent data-[expanded]:text-muted-foreground absolute right-4 top-4 rounded-sm opacity-70 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:pointer-events-none">
							<IconTablerX class="h-4 w-4" />
							<span class="sr-only">Close</span>
						</DialogPrimitive.CloseButton>
					</Show>
				</DialogPrimitive.Content>
			</div>
		</DialogPortal>
	);
};

const DialogHeader: Component<ComponentProps<"div">> = (props) => {
	const [, rest] = splitProps(props, ["class"]);
	return (
		<div
			class={clsx(
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
			class={clsx(
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
			class={clsx(
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
			class={clsx("text-muted-foreground text-sm", props.class)}
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
