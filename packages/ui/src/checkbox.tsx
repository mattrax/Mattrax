import type { Component } from "solid-js";
import { splitProps } from "solid-js";

import { Checkbox as CheckboxPrimitive } from "@kobalte/core";
import { TbCheck } from "solid-icons/tb";

import { cn } from "./lib";

const Checkbox: Component<CheckboxPrimitive.CheckboxRootProps> = (props) => {
	const [, rest] = splitProps(props, ["class"]);
	return (
		<CheckboxPrimitive.Root
			class={cn("items-top flex space-x-2", props.class)}
			{...rest}
		>
			<CheckboxPrimitive.Input class="peer" />
			<CheckboxPrimitive.Control
				class="border-primary ring-offset-background data-[checked]:bg-primary data-[checked]:text-primary-foreground h-4 w-4 shrink-0 rounded-sm border peer-focus-visible:outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 data-[checked]:border-none"
				onClick={(e) => {
					e.stopPropagation();
				}}
			>
				<CheckboxPrimitive.Indicator>
					<TbCheck class="h-4 w-4" />
				</CheckboxPrimitive.Indicator>
			</CheckboxPrimitive.Control>
		</CheckboxPrimitive.Root>
	);
};

export { Checkbox };
