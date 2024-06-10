import type { Component, ComponentProps } from "solid-js";
import { splitProps } from "solid-js";

import clsx from "clsx";

const Card: Component<ComponentProps<"div">> = (props) => {
	const [, rest] = splitProps(props, ["class"]);
	return (
		<div
			class={clsx(
				"bg-card text-card-foreground rounded-lg border shadow-sm",
				props.class,
			)}
			{...rest}
		/>
	);
};

const CardHeader: Component<ComponentProps<"div">> = (props) => {
	const [, rest] = splitProps(props, ["class"]);
	return (
		<div class={clsx("flex flex-col space-y-1.5 p-6", props.class)} {...rest} />
	);
};

const CardTitle: Component<ComponentProps<"h3">> = (props) => {
	const [, rest] = splitProps(props, ["class"]);
	return (
		<h3
			class={clsx(
				"text-lg font-semibold leading-none tracking-tight",
				props.class,
			)}
			{...rest}
		/>
	);
};

const CardDescription: Component<ComponentProps<"p">> = (props) => {
	const [, rest] = splitProps(props, ["class"]);
	return (
		<p class={clsx("text-muted-foreground text-sm", props.class)} {...rest} />
	);
};

const CardContent: Component<ComponentProps<"div">> = (props) => {
	const [, rest] = splitProps(props, ["class"]);
	return <div class={clsx("p-6 pt-0", props.class)} {...rest} />;
};

const CardFooter: Component<ComponentProps<"div">> = (props) => {
	const [, rest] = splitProps(props, ["class"]);
	return (
		<div class={clsx("flex items-center p-6 pt-0", props.class)} {...rest} />
	);
};

export {
	Card,
	CardHeader,
	CardFooter,
	CardTitle,
	CardDescription,
	CardContent,
};
