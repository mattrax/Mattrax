import {
	Checkbox as CheckboxPrimitive,
	type PolymorphicProps,
} from "@kobalte/core";
import type { CheckboxRootProps } from "@kobalte/core/checkbox";
import clsx from "clsx";
import type { ValidComponent } from "solid-js";
import { splitProps } from "solid-js";

import { cn } from "./lib";

const Checkbox = <T extends ValidComponent = "div">(
	props: PolymorphicProps<T, CheckboxRootProps>,
) => {
	const [, rest] = splitProps(props as any, ["class"]);
	return (
		<CheckboxPrimitive.Root class={cn("items-top flex", props.class)} {...rest}>
			<CheckboxPrimitive.Input class="peer" style={{ position: "relative" }} />
			<CheckboxPrimitive.Control
				class={clsx(
					"border-primary ring-offset-background data-[checked]:bg-primary data-[checked]:text-primary-foreground h-4 w-4 shrink-0 rounded-sm border",
					"peer-focus-visible:outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-ring transition-all duration-75",
					"disabled:cursor-not-allowed disabled:opacity-50 data-[checked]:border-none",
				)}
				onClick={(e) => {
					e.stopPropagation();
				}}
			>
				<CheckboxPrimitive.Indicator>
					<IconTablerCheck class="h-4 w-4" />
				</CheckboxPrimitive.Indicator>
			</CheckboxPrimitive.Control>
		</CheckboxPrimitive.Root>
	);
};

export { Checkbox };
