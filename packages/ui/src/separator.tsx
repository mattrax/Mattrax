import type { ValidComponent } from "solid-js";
import { splitProps } from "solid-js";

import {
	type PolymorphicProps,
	Separator as SeparatorPrimitive,
} from "@kobalte/core";
import type { SeparatorRootProps } from "@kobalte/core/separator";

import clsx from "clsx";

const Separator = <T extends ValidComponent = "hr">(
	props: PolymorphicProps<T, SeparatorRootProps>,
) => {
	const [, rest] = splitProps(props as any, ["class", "orientation"]);
	return (
		<SeparatorPrimitive.Root
			orientation={props.orientation ?? "horizontal"}
			class={clsx(
				"bg-border shrink-0",
				props.orientation === "vertical" ? "h-full w-[1px]" : "h-[1px] w-full",
				props.class,
			)}
			{...rest}
		/>
	);
};

export { Separator };
