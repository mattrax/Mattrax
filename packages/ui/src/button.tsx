import type { Component, ComponentProps, JSX } from "solid-js";
import { splitProps } from "solid-js";

import type { VariantProps } from "class-variance-authority";
import { cva } from "class-variance-authority";

import clsx from "clsx";
import { createSignal } from "solid-js";

const buttonVariants = cva(
	[
		"ring-offset-background focus-visible:ring-ring inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors transition-shadow",
		"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
		"disabled:pointer-events-none disabled:opacity-50",
	],
	{
		variants: {
			variant: {
				default: "bg-primary text-primary-foreground hover:bg-primary/90",
				destructive:
					"bg-destructive text-destructive-foreground hover:bg-destructive/90",
				outline:
					"border-input hover:bg-accent hover:text-accent-foreground border",
				secondary:
					"bg-secondary text-secondary-foreground hover:bg-secondary/80",
				ghost: "hover:bg-accent hover:text-accent-foreground",
				link: "text-primary underline-offset-4 hover:underline",
			},
			size: {
				default: "h-10 px-4 py-2",
				sm: "h-9 rounded-md px-3",
				lg: "h-11 rounded-md px-8",
				icon: "h-10 w-10",
				iconSmall: "h-6 w-6",
			},
		},
		defaultVariants: {
			variant: "default",
			size: "default",
		},
	},
);

export interface ButtonProps
	extends ComponentProps<"button">,
		VariantProps<typeof buttonVariants> {}

const Button: Component<ButtonProps> = (props) => {
	const [, rest] = splitProps(props, ["variant", "size", "class", "type"]);
	return (
		<button
			type={props.type || "button"}
			class={clsx(
				buttonVariants({ variant: props.variant, size: props.size }),
				props.class,
			)}
			{...rest}
		/>
	);
};

const DoubleClickButton: Component<
	Omit<ButtonProps, "children" | "onClick"> & {
		onClick: JSX.EventHandler<HTMLButtonElement, MouseEvent>;
		children: (_: boolean) => JSX.Element;
	}
> = (props) => {
	const [clicked, setClicked] = createSignal(false);
	const [, rest] = splitProps(props, [
		"variant",
		"size",
		"class",
		"type",
		"children",
		"onClick",
	]);
	return (
		<button
			type={props.type || "button"}
			class={clsx(
				buttonVariants({ variant: props.variant, size: props.size }),
				props.class,
			)}
			onClick={(e) => {
				if (!clicked()) {
					setClicked(true);
					setTimeout(() => setClicked(false), 1000);
					return;
				}
				props.onClick?.(e);
			}}
			{...rest}
		>
			{props.children(clicked())}
		</button>
	);
};

const AsyncButton: Component<
	Omit<ButtonProps, "onClick"> & {
		onClick?: (
			...args: Parameters<JSX.EventHandler<HTMLButtonElement, MouseEvent>>
		) => any;
	}
> = (props) => {
	const [inProgress, setInProgress] = createSignal(false);

	return (
		<Button
			{...props}
			disabled={inProgress() || props.disabled}
			onClick={(...args) => {
				if (!props.onClick) return;

				setInProgress(true);
				props.onClick(...args)?.finally(() => setInProgress(false)) ??
					setInProgress(false);
			}}
		/>
	);
};

export { Button, DoubleClickButton, AsyncButton, buttonVariants };
