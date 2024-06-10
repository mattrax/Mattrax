import type { Component, ComponentProps } from "solid-js";
import { splitProps } from "solid-js";

import clsx from "clsx";

const Table: Component<ComponentProps<"table">> = (props) => {
	const [, rest] = splitProps(props, ["class"]);
	return (
		<div class="relative w-full overflow-auto">
			<table
				class={clsx("w-full caption-bottom text-sm", props.class)}
				{...rest}
			/>
		</div>
	);
};

const TableHeader: Component<ComponentProps<"thead">> = (props) => {
	const [, rest] = splitProps(props, ["class"]);
	return <thead class={clsx("[&_tr]:border-b", props.class)} {...rest} />;
};

const TableBody: Component<ComponentProps<"tbody">> = (props) => {
	const [, rest] = splitProps(props, ["class"]);
	return (
		<tbody class={clsx("[&_tr:last-child]:border-0", props.class)} {...rest} />
	);
};

const TableFooter: Component<ComponentProps<"tfoot">> = (props) => {
	const [, rest] = splitProps(props, ["class"]);
	return (
		<tfoot
			class={clsx(
				"bg-primary text-primary-foreground font-medium",
				props.class,
			)}
			{...rest}
		/>
	);
};

const TableRow: Component<ComponentProps<"tr">> = (props) => {
	const [, rest] = splitProps(props, ["class"]);
	return (
		<tr
			class={clsx(
				"hover:bg-muted/50 data-[state=selected]:bg-muted border-b transition-colors",
				props.class,
			)}
			{...rest}
		/>
	);
};

const TableHead: Component<ComponentProps<"th">> = (props) => {
	const [, rest] = splitProps(props, ["class"]);
	return (
		<th
			class={clsx(
				"text-muted-foreground h-12 px-4 text-left align-middle font-medium [&:has([role=checkbox])]:pr-0",
				props.class,
			)}
			{...rest}
		/>
	);
};

const TableCell: Component<ComponentProps<"td">> = (props) => {
	const [, rest] = splitProps(props, ["class"]);
	return (
		<td
			class={clsx(
				"p-4 align-middle [&:has([role=checkbox])]:pr-0",
				props.class,
			)}
			{...rest}
		/>
	);
};

const TableCaption: Component<ComponentProps<"caption">> = (props) => {
	const [, rest] = splitProps(props, ["class"]);
	return (
		<caption
			class={clsx("text-muted-foreground mt-4 text-sm", props.class)}
			{...rest}
		/>
	);
};

export {
	Table,
	TableHeader,
	TableBody,
	TableFooter,
	TableHead,
	TableRow,
	TableCell,
	TableCaption,
};
