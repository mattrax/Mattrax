import { A } from "@solidjs/router";
import clsx from "clsx";
import type { ComponentProps } from "solid-js";

const Breadcrumb = (props: ComponentProps<"nav">) => (
	<nav aria-label="breadcrumb" {...props} />
);

const BreadcrumbList = (props: ComponentProps<"ol">) => (
	<ol
		class={clsx(
			"flex flex-wrap items-center gap-1.5 break-words text-sm text-zinc-500 sm:gap-2.5 dark:text-zinc-400",
			props.class,
		)}
		{...props}
	/>
);

const BreadcrumbItem = (props: ComponentProps<"li">) => (
	<li class="inline-flex items-center gap-1.5" {...props} />
);

const BreadcrumbLink = (props: ComponentProps<typeof A>) => (
	<A
		class={clsx(
			"transition-colors hover:text-zinc-950 dark:hover:text-zinc-50",
			props.class,
		)}
		{...props}
	/>
);

const BreadcrumbPage = (props: ComponentProps<"span">) => (
	<span
		role={props.role ?? "link"}
		aria-disabled={props["aria-disabled"] ?? "true"}
		aria-current={props["aria-current"] ?? "page"}
		class={clsx("font-normal text-zinc-950 dark:text-zinc-50", props.class)}
		{...props}
	/>
);

const BreadcrumbSeparator = (props: ComponentProps<"li">) => (
	<li
		role={props.role ?? "presentation"}
		aria-hidden={props["aria-hidden"] ?? "true"}
		class={clsx("flex h-9 w-9 items-center justify-center", props.class)}
	>
		{props.children ?? <IconPhCaretRight />}
	</li>
);

const BreadcrumbEllipsis = (props: ComponentProps<"span">) => (
	<span
		role={props.role ?? "presentation"}
		aria-hidden={props["aria-hidden"] ?? "true"}
		class={clsx("flex h-9 w-9 items-center justify-center", props.class)}
	>
		<IconPhDotsThree class="h-4 w-4" />
		<span class="sr-only">More</span>
	</span>
);

export {
	Breadcrumb,
	BreadcrumbList,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbPage,
	BreadcrumbSeparator,
	BreadcrumbEllipsis,
};
