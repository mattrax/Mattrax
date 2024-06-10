import {
	AlertDialog as AlertDialogPrimitive,
	type PolymorphicProps,
} from "@kobalte/core";
import type {
	AlertDialogContentProps,
	AlertDialogDescriptionProps,
	AlertDialogOverlayProps,
	AlertDialogTitleProps,
} from "@kobalte/core/alert-dialog";
import type { ValidComponent } from "solid-js";
import { splitProps } from "solid-js";

import clsx from "clsx";

const AlertDialog = AlertDialogPrimitive.Root;
const AlertDialogTrigger = AlertDialogPrimitive.Trigger;
const AlertDialogPortal = AlertDialogPrimitive.Portal;

const AlertDialogOverlay = <T extends ValidComponent = "div">(
	props: PolymorphicProps<T, AlertDialogOverlayProps>,
) => {
	const [, rest] = splitProps(props as any, ["class"]);
	return (
		<AlertDialogPrimitive.Overlay
			class={clsx(
				"bg-background/80 data-[expanded]:animate-in data-[closed]:animate-out data-[closed]:fade-out-0 data-[expanded]:fade-in-0 fixed inset-0 z-50 backdrop-blur-sm",
				props.class,
			)}
			{...rest}
		/>
	);
};

const AlertDialogContent = <T extends ValidComponent = "div">(
	props: PolymorphicProps<T, AlertDialogContentProps>,
) => {
	const [, rest] = splitProps(props as any, ["class", "children"]);
	return (
		<AlertDialogPortal>
			<AlertDialogOverlay />
			<AlertDialogPrimitive.Content
				class={clsx(
					"bg-background data-[expanded]:animate-in data-[closed]:animate-out data-[closed]:fade-out-0 data-[expanded]:fade-in-0 data-[closed]:zoom-out-95 data-[expanded]:zoom-in-95 data-[closed]:slide-out-to-left-1/2 data-[closed]:slide-out-to-top-[48%] data-[expanded]:slide-in-from-left-1/2 data-[expanded]:slide-in-from-top-[48%] fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border p-6 shadow-lg duration-200 sm:rounded-lg md:w-full",
					props.class,
				)}
				{...rest}
			>
				{props.children}
				<AlertDialogPrimitive.CloseButton class="ring-offset-background focus:ring-ring data-[expanded]:bg-accent data-[expanded]:text-muted-foreground absolute right-4 top-4 rounded-sm opacity-70 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:pointer-events-none">
					<IconTablerX class="h-4 w-4" />
					<span class="sr-only">Close</span>
				</AlertDialogPrimitive.CloseButton>
			</AlertDialogPrimitive.Content>
		</AlertDialogPortal>
	);
};

const AlertDialogTitle = <T extends ValidComponent = "h1">(
	props: PolymorphicProps<T, AlertDialogTitleProps>,
) => {
	const [, rest] = splitProps(props as any, ["class"]);
	return (
		<AlertDialogPrimitive.Title
			class={clsx("text-lg font-semibold", props.class)}
			{...rest}
		/>
	);
};

const AlertDialogDescription = <T extends ValidComponent = "p">(
	props: PolymorphicProps<T, AlertDialogDescriptionProps>,
) => {
	const [, rest] = splitProps(props as any, ["class"]);
	return (
		<AlertDialogPrimitive.Description
			class={clsx("text-muted-foreground text-sm", props.class)}
			{...rest}
		/>
	);
};

export {
	AlertDialog,
	AlertDialogPortal,
	AlertDialogOverlay,
	AlertDialogTrigger,
	AlertDialogContent,
	AlertDialogTitle,
	AlertDialogDescription,
};
