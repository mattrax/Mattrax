import clsx from "clsx";
import type { ComponentProps } from "solid-js";

export function DescriptionList(props: ComponentProps<"dl">) {
	return (
		<dl
			{...props}
			class={clsx(
				props.class,
				"grid grid-cols-1 text-base/6 sm:grid-cols-[min(50%,theme(spacing.80))_auto] sm:text-sm/6",
			)}
		/>
	);
}

export function DescriptionTerm(props: ComponentProps<"dt">) {
	return (
		<dt
			{...props}
			class={clsx(
				props.class,
				"col-start-1 border-t border-zinc-950/5 pt-3 text-black first:border-none sm:border-t sm:border-zinc-950/5 sm:py-3 dark:border-white/5 dark:text-zinc-400 sm:dark:border-white/5",
			)}
		/>
	);
}

export function DescriptionDetails(props: ComponentProps<"dd">) {
	return (
		<dd
			{...props}
			class={clsx(
				props.class,
				"pb-3 pt-1 text-zinc-950 sm:border-t sm:border-zinc-950/5 sm:py-3 dark:text-white dark:sm:border-white/5 sm:[&:nth-child(2)]:border-none",
			)}
		/>
	);
}
