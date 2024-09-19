import type { Component, ComponentProps, JSX } from "solid-js";
import { splitProps } from "solid-js";

import type { VariantProps } from "class-variance-authority";
import { cva } from "class-variance-authority";

import clsx from "clsx";
import { createSignal } from "solid-js";

const buttonVariants = cva(
	"inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-950 disabled:pointer-events-none disabled:opacity-50 dark:focus-visible:ring-zinc-300",
	{
		variants: {
			variant: {
				default:
					"bg-zinc-900 text-zinc-50 shadow hover:bg-zinc-900/90 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-50/90",
				destructive:
					"bg-red-500 text-zinc-50 shadow-sm hover:bg-red-500/90 dark:bg-red-900 dark:text-zinc-50 dark:hover:bg-red-900/90",
				outline:
					"border border-zinc-200 bg-white shadow-sm hover:bg-zinc-100 hover:text-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-800 dark:hover:text-zinc-50",
				secondary:
					"bg-zinc-100 text-zinc-900 shadow-sm hover:bg-zinc-100/80 dark:bg-zinc-800 dark:text-zinc-50 dark:hover:bg-zinc-800/80",
				ghost:
					"hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-50",
				link: "text-zinc-900 underline-offset-4 hover:underline dark:text-zinc-50",
			},
			size: {
				default: "h-9 px-4 py-2",
				sm: "h-8 rounded-md px-3 text-xs",
				lg: "h-10 rounded-md px-8",
				icon: "h-9 w-9",
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
