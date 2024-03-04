import { ComponentProps, JSX } from "solid-js";
import clsx from "clsx";

export function PageLayout(
	props: Omit<ComponentProps<"div">, "class"> & {
		heading?: JSX.Element;
		size?: "md" | "lg";
	},
) {
	return (
		<div
			{...props}
			class={clsx(
				"px-4 w-full mx-auto gap-4",
				props.size === "lg" ? "max-w-6xl" : "max-w-5xl",
			)}
		>
			{props.heading && (
				<div class="flex flex-row items-center h-24 gap-4">{props.heading}</div>
			)}
			<div class="gap-4 flex flex-col">{props.children}</div>
		</div>
	);
}

export function PageLayoutHeading(props: ComponentProps<"h1">) {
	return <h1 {...props} class={clsx("text-3xl font-bold", props.class)} />;
}
