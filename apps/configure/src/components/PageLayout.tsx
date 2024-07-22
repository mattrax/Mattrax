/// Coped from `@mattrax/web` we should probs break out and share?

import clsx from "clsx";
import {
	type ComponentProps,
	type JSX,
	Show,
	children,
	splitProps,
} from "solid-js";

export function PageLayout(
	props: ComponentProps<"div"> & {
		heading?: JSX.Element;
	},
) {
	const c = children(() => props.heading || null);
	const [_, divProps] = splitProps(props, ["heading"]);

	return (
		<div
			{...divProps}
			class={clsx("px-4 pb-8 w-full mx-auto gap-4", props.class)}
		>
			<Show when={c()}>
				{(c) => (
					<div class="flex flex-row items-center justify-between h-24 gap-4">
						{c()}
					</div>
				)}
			</Show>
			<div class="gap-4 flex flex-col">{props.children}</div>
		</div>
	);
}

export function PageLayoutHeading(props: ComponentProps<"h1">) {
	return <h1 {...props} class={clsx("text-3xl font-bold", props.class)} />;
}
