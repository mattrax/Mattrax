/// Coped from `@mattrax/web` we should probs break out and share?

import clsx from "clsx";
import {
	type ComponentProps,
	type JSX,
	Show,
	Suspense,
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
		<div class="w-screen">
			{/* ^ This div ensures the scrollbar's presence of a page scrollbar does't shift the content */}
			<div
				{...divProps}
				class={clsx("px-4 pb-8 w-full mx-auto gap-4 max-w-7xl", props.class)}
			>
				<Show when={c()}>
					{(c) => (
						<div class="flex flex-row items-center justify-between py-4 gap-4">
							{c()}
						</div>
					)}
				</Show>
				<div class="gap-4 flex flex-col">{props.children}</div>
			</div>
		</div>
	);
}

export function PageLayoutHeading(props: ComponentProps<"h1">) {
	return (
		<h1 {...props} class={clsx("text-3xl font-bold relative", props.class)}>
			<Suspense
				fallback={
					<>
						<span class="opacity-0">0</span>
						<div class="w-16 bg-neutral-200 animate-pulse absolute inset-y-0 rounded-full" />
					</>
				}
			>
				{props.children}
			</Suspense>
		</h1>
	);
}
