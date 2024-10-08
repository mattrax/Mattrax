import type { Component, ComponentProps } from "solid-js";
import { splitProps } from "solid-js";

import clsx from "clsx";
import { type ButtonProps, buttonVariants } from "./button";

const Pagination: Component<ComponentProps<"nav">> = (props) => {
	const [, rest] = splitProps(props, ["class"]);
	return (
		<nav
			aria-label="pagination"
			class={clsx("mx-auto flex w-full justify-center", props.class)}
			{...rest}
		/>
	);
};

const PaginationContent: Component<ComponentProps<"ul">> = (props) => {
	const [, rest] = splitProps(props, ["class"]);
	return (
		<ul
			class={clsx("flex flex-row items-center gap-1", props.class)}
			{...rest}
		/>
	);
};

const PaginationItem: Component<ComponentProps<"li">> = (props) => {
	const [, rest] = splitProps(props, ["class"]);
	return <li class={clsx("", props.class)} {...rest} />;
};

type PaginationLinkProps = {
	isActive?: boolean;
} & Pick<ButtonProps, "size"> &
	ComponentProps<"a">;

const PaginationLink = (props: PaginationLinkProps) => {
	const [, rest] = splitProps(props, ["class", "isActive", "size"]);

	return (
		<PaginationItem>
			<a
				aria-current={props.isActive ? "page" : undefined}
				class={clsx(
					buttonVariants({
						variant: props.isActive ? "outline" : "ghost",
						size: props.size ?? "icon",
					}),
					props.class,
				)}
				{...rest}
			/>
		</PaginationItem>
	);
};

const PaginationPrevious: typeof PaginationLink = (props) => {
	const [, rest] = splitProps(props, ["class"]);
	return (
		<PaginationLink
			aria-label="Go to previous page"
			size="default"
			class={clsx("gap-1 pl-2.5", props.class)}
			{...rest}
		>
			<IconTablerChevronLeft class="h-4 w-4" />
			<span>Previous</span>
		</PaginationLink>
	);
};

const PaginationNext: typeof PaginationLink = (props) => {
	const [, rest] = splitProps(props, ["class"]);
	return (
		<PaginationLink
			aria-label="Go to next page"
			size="default"
			class={clsx("gap-1 pr-2.5", props.class)}
			{...rest}
		>
			<span>Next</span>
			<IconTablerChevronRight class="h-4 w-4" />
		</PaginationLink>
	);
};

const PaginationEllipsis: Component<ComponentProps<"span">> = (props) => {
	const [, rest] = splitProps(props, ["class"]);
	return (
		<span
			aria-hidden
			class={clsx("flex h-9 w-9 items-center justify-center", props.class)}
			{...rest}
		>
			<IconTablerDots class="h-4 w-4" />
			<span class="sr-only">More pages</span>
		</span>
	);
};

export {
	Pagination,
	PaginationContent,
	PaginationEllipsis,
	PaginationItem,
	PaginationLink,
	PaginationNext,
	PaginationPrevious,
};
