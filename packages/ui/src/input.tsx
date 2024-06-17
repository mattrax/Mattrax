import type { Component, ComponentProps } from "solid-js";
import { splitProps } from "solid-js";

import clsx from "clsx";

const Input: Component<ComponentProps<"input">> = (props) => {
	const [local, rest] = splitProps(props, ["type", "class"]);
	return (
		<input
			type={local.type}
			class={clsx(
				"border-input ring-offset-background placeholder:text-muted-foreground flex h-10 w-full rounded-md border bg-transparent px-3 py-2 text-sm",
				"focus-visible:outline-none focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2 transition-shadow duration-75",
				"disabled:cursor-not-allowed disabled:opacity-50",
				"file:border-0 file:bg-transparent file:text-sm file:font-medium",
				local.class,
			)}
			{...rest}
		/>
	);
};

export { Input };
