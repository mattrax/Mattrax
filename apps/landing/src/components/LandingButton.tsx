import { type VariantProps, cva } from "class-variance-authority";
import clsx from "clsx";
import { type ComponentProps, type JSXElement, splitProps } from "solid-js";

const buttonVariants = cva(
	[
		"flex flex-row items-center gap-1.5 rounded-full transition-all duration-300",
		"py-2.5 px-5 text-sm font-medium relative text-white button-inner-shadow",
	],
	{
		variants: {
			variant: {
				default:
					"bg-gradient-to-b from-blue-500 to-blue-700 outline outline-1 outline-offset-[-1px] outline-blue-600 blue-shadow",
				black:
					"bg-zinc-700 outline outline-1 outline-offset-[-1px] outline-zinc-700 black-shadow",
			},
		},
		defaultVariants: {
			variant: "default",
		},
	},
);

interface Props
	extends ComponentProps<"button">,
		VariantProps<typeof buttonVariants> {
	children?: JSXElement;
}

const LandingButton = (props: Props) => {
	const [, rest] = splitProps(props, ["variant", "children", "class"]);
	return (
		<button
			type="button"
			class={clsx(buttonVariants({ variant: props.variant }), props.class)}
			{...rest}
		>
			{props.children}
		</button>
	);
};

export default LandingButton;
