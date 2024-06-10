import type { Component, ComponentProps } from "solid-js";
import { splitProps } from "solid-js";

import type { VariantProps } from "class-variance-authority";
import { cva } from "class-variance-authority";

import clsx from "clsx";

const badgeVariants = cva(
	"focus:ring-ring inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2",
	{
		variants: {
			variant: {
				default:
					"bg-primary text-primary-foreground hover:bg-primary/80 border-transparent",
				secondary:
					"bg-secondary text-secondary-foreground hover:bg-secondary/80 border-transparent",
				destructive:
					"bg-destructive text-destructive-foreground hover:bg-destructive/80 border-transparent",
				success:
					"bg-success text-success-foreground hover:bg-success/80 border-transparent",
				outline: "text-foreground",
				ghost: "",
			},
		},
		defaultVariants: {
			variant: "default",
		},
	},
);

export interface BadgeProps
	extends ComponentProps<"div">,
		VariantProps<typeof badgeVariants> {}

const Badge: Component<BadgeProps> = (props) => {
	const [, rest] = splitProps(props, ["variant", "class"]);
	return (
		<div
			class={clsx(badgeVariants({ variant: props.variant }), props.class)}
			{...rest}
		/>
	);
};

export { Badge, badgeVariants };
