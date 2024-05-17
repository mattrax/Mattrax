import type { Component } from "solid-js";
import { splitProps } from "solid-js";

import {
	type PolymorphicProps,
	Separator as SeparatorPrimitive,
} from "@kobalte/core";
import type { SeparatorRootProps } from "@kobalte/core/separator";

import { cn } from "./lib";

const Separator: Component<PolymorphicProps<"hr", SeparatorRootProps>> = (
	props,
) => {
	const [, rest] = splitProps(props, ["class", "orientation"]);
	return (
		<SeparatorPrimitive.Root
			orientation={props.orientation ?? "horizontal"}
			class={cn(
				"bg-border shrink-0",
				props.orientation === "vertical" ? "h-full w-[1px]" : "h-[1px] w-full",
				props.class,
			)}
			{...rest}
		/>
	);
};

export { Separator };
