import { Component, ComponentProps, JSX, createUniqueId } from "solid-js";
import { splitProps } from "solid-js";

import { cn } from "~/lib/utils";
import { Label } from ".";

const Input: Component<ComponentProps<"input"> & { label?: JSX.Element }> = (
	props,
) => {
	const [, rest] = splitProps(props, ["type", "class", "label"]);

	const id = createUniqueId();

	let input = (
		<input
			{...rest}
			id={props.id ?? id}
			type={props.type}
			class={cn(
				"border-input ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring flex h-10 w-full rounded-md border bg-transparent px-3 py-2 text-sm file:border-0 file:bg-transparent file:text-sm file:font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
				props.class,
			)}
		/>
	);

	return (
		<>
			{props.label !== undefined ? (
				<div class="flex flex-col gap-2">
					<Label for={props.id ?? id}>{props.label}</Label>
					{input}
				</div>
			) : (
				input
			)}
		</>
	);
};

export { Input };
