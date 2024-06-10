import type { Component, ComponentProps } from "solid-js";
import { splitProps } from "solid-js";

import clsx from "clsx";

const Skeleton: Component<ComponentProps<"div">> = (props) => {
	const [, rest] = splitProps(props, ["class"]);
	return (
		<div
			class={clsx("bg-primary/10 animate-pulse rounded-md", props.class)}
			{...rest}
		/>
	);
};

export { Skeleton };
