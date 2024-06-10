import clsx from "clsx";
import {
	type ComponentProps,
	type JSX,
	splitProps,
	Show,
	children,
} from "solid-js";

export function PageLayout(
	props: ComponentProps<"div"> & {
		heading?: JSX.Element;
		size?: "md" | "lg";
	},
) {
	const c = children(() => props.heading || null);
	const [_, divProps] = splitProps(props, ["heading", "size"]);

	return (
		<div
			{...divProps}
			class={clsx(
				"px-4 pb-4 w-full mx-auto gap-4",
				props.size === "lg" ? "max-w-6xl" : "max-w-5xl",
				props.class,
			)}
		>
			<Show when={c()}>
				{(c) => <div class="flex flex-row items-center h-24 gap-4">{c()}</div>}
			</Show>
			<div class="gap-4 flex flex-col">{props.children}</div>
		</div>
	);
}

export function PageLayoutHeading(props: ComponentProps<"h1">) {
	return <h1 {...props} class={clsx("text-3xl font-bold", props.class)} />;
}
