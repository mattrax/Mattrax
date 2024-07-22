import type { ValidComponent } from "solid-js";
import { splitProps } from "solid-js";

import {
	type PolymorphicProps,
	ToggleButton as ToggleButtonPrimitive,
} from "@kobalte/core";
import type { ToggleButtonRootProps } from "@kobalte/core/toggle-button";
import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";

import clsx from "clsx";

const toggleVariants = cva(
	"inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
	{
		variants: {
			variant: {
				default: "bg-transparent",
				outline: "border border-input bg-transparent shadow-sm",
			},
			size: {
				default: "h-9 px-3",
				sm: "h-8 px-2",
				lg: "h-10 px-3",
			},
		},
		defaultVariants: {
			variant: "default",
			size: "default",
		},
	},
);

export type ToggleProps<T extends ValidComponent = "button"> = PolymorphicProps<
	T,
	ToggleButtonRootProps
> &
	VariantProps<typeof toggleVariants>;

const Toggle = <T extends ValidComponent = "button">(props: ToggleProps<T>) => {
	const [, rest] = splitProps(props as any, ["class", "variant", "size"]);
	return (
		<ToggleButtonPrimitive.Root
			class={clsx(
				toggleVariants({ variant: props.variant, size: props.size }),
				props.class,
			)}
			{...rest}
		/>
	);
};

export { toggleVariants, Toggle };
