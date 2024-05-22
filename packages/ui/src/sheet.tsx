import { type PolymorphicProps, Dialog as SheetPrimitive } from "@kobalte/core";
import type {
	DialogDescriptionProps,
	DialogOverlayProps,
	DialogPortalProps,
	DialogTitleProps,
	DialogContentProps as KDialogContentProps,
	DialogTriggerProps as KDialogTriggerProps,
} from "@kobalte/core/dialog";
import { type VariantProps, cva } from "class-variance-authority";
import type { Component, ComponentProps, ValidComponent } from "solid-js";
import { mergeProps, splitProps } from "solid-js";

import { cn } from "./lib";

const Sheet = SheetPrimitive.Root;

function SheetTrigger<T extends ValidComponent = "button">(
	props: PolymorphicProps<T, KDialogTriggerProps>,
) {
	return <SheetPrimitive.Trigger {...props} />;
}

const SheetClose = SheetPrimitive.CloseButton;

const portalVariants = cva("fixed inset-0 z-50 flex", {
	variants: {
		position: {
			top: "items-start",
			bottom: "items-end",
			left: "justify-start",
			right: "justify-end",
		},
	},
	defaultVariants: { position: "right" },
});

interface SheetPortalProps
	extends DialogPortalProps,
		VariantProps<typeof portalVariants> {}

const SheetPortal: Component<SheetPortalProps> = (props) => {
	const [, rest] = splitProps(props, ["position", "children"]);
	return (
		<SheetPrimitive.Portal {...rest}>
			<div class={portalVariants({ position: props.position })}>
				{props.children}
			</div>
		</SheetPrimitive.Portal>
	);
};

const SheetOverlay = <T extends ValidComponent = "div">(
	props: PolymorphicProps<T, DialogOverlayProps> & { transparent?: boolean },
) => {
	const [, rest] = splitProps(props as any, ["class", "transparent"]);
	return (
		<SheetPrimitive.Overlay
			class={cn(
				"ui-closed:animate-out ui-closed:fade-out ui-expanded:animate-in ui-expanded:fade-in fixed inset-0 z-50 transition-all duration-100",
				!props.transparent && "bg-background/80 backdrop-blur-sm",
				props.class,
			)}
			{...rest}
		/>
	);
};

const sheetVariants = cva(
	"bg-background fixed z-50 scale-100 border opacity-100 shadow-lg ui-expanded:animate-in ui-closed:animate-out",
	{
		variants: {
			position: {
				top: "ui-expanded:slide-in-from-top ui-closed:slide-out-to-top w-full duration-300",
				bottom:
					"ui-expanded:slide-in-from-bottom ui-closed:slide-out-to-bottom w-full duration-300",
				left: "ui-expanded:slide-in-from-left ui-closed:slide-out-to-left h-full duration-300",
				right:
					"ui-expanded:slide-in-from-right ui-closed:slide-out-to-right h-full duration-300",
			},
			size: {
				content: "",
				default: "",
				sm: "",
				lg: "",
				xl: "",
				full: "",
			},
			padding: {
				default: "p-6",
				none: "",
			},
		},
		compoundVariants: [
			{
				position: ["top", "bottom"],
				size: "content",
				class: "max-h-screen",
			},
			{
				position: ["top", "bottom"],
				size: "default",
				class: "h-1/3",
			},
			{
				position: ["top", "bottom"],
				size: "sm",
				class: "h-1/4",
			},
			{
				position: ["top", "bottom"],
				size: "lg",
				class: "h-1/2",
			},
			{
				position: ["top", "bottom"],
				size: "xl",
				class: "h-5/6",
			},
			{
				position: ["top", "bottom"],
				size: "full",
				class: "h-screen",
			},
			{
				position: ["right", "left"],
				size: "content",
				class: "max-w-screen",
			},
			{
				position: ["right", "left"],
				size: "default",
				class: "w-1/3",
			},
			{
				position: ["right", "left"],
				size: "sm",
				class: "w-1/4",
			},
			{
				position: ["right", "left"],
				size: "lg",
				class: "w-1/2",
			},
			{
				position: ["right", "left"],
				size: "xl",
				class: "w-5/6",
			},
			{
				position: ["right", "left"],
				size: "full",
				class: "w-screen",
			},
		],
		defaultVariants: {
			position: "right",
			size: "default",
			padding: "default",
		},
	},
);

export type DialogContentProps<T extends ValidComponent = "div"> =
	PolymorphicProps<T, KDialogContentProps> &
		VariantProps<typeof sheetVariants> & { transparent?: boolean };

const SheetContent = <T extends ValidComponent = "div">(
	_props: DialogContentProps<T>,
) => {
	const props = mergeProps({ transparent: true }, _props);

	const [, rest] = splitProps(props as any, [
		"position",
		"size",
		"class",
		"children",
		"transparent",
		"padding",
	]);

	return (
		<SheetPortal position={props.position}>
			<SheetOverlay transparent={props.transparent ?? true} />
			<SheetPrimitive.Content
				class={cn(
					sheetVariants({
						position: props.position,
						size: props.size,
						padding: props.padding,
					}),
					props.class,
				)}
				{...rest}
			>
				{props.children}
				<SheetPrimitive.CloseButton class="ring-offset-background focus:ring-ring data-[state=open]:bg-secondary absolute right-4 top-4 rounded-sm opacity-70 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:pointer-events-none">
					<IconTablerX class="h-4 w-4" />
					<span class="sr-only">Close</span>
				</SheetPrimitive.CloseButton>
			</SheetPrimitive.Content>
		</SheetPortal>
	);
};

const SheetHeader: Component<ComponentProps<"div">> = (props) => {
	const [, rest] = splitProps(props, ["class"]);
	return (
		<div
			class={cn(
				"flex flex-col space-y-2 text-center sm:text-left",
				props.class,
			)}
			{...rest}
		/>
	);
};

const SheetFooter: Component<ComponentProps<"div">> = (props) => {
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

const SheetTitle = <T extends ValidComponent = "h2">(
	props: PolymorphicProps<T, DialogTitleProps>,
) => {
	const [, rest] = splitProps(props as any, ["class"]);
	return (
		<SheetPrimitive.Title
			class={cn("text-foreground text-lg font-semibold", props.class)}
			{...rest}
		/>
	);
};

const SheetDescription = <T extends ValidComponent = "p">(
	props: PolymorphicProps<T, DialogDescriptionProps>,
) => {
	const [, rest] = splitProps(props as any, ["class"]);
	return (
		<SheetPrimitive.Description
			class={cn("text-muted-foreground text-sm", props.class)}
			{...rest}
		/>
	);
};

export {
	Sheet,
	SheetTrigger,
	SheetClose,
	SheetContent,
	SheetHeader,
	SheetFooter,
	SheetTitle,
	SheetDescription,
};
