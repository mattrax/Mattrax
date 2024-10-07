import type { Component, ComponentProps, ParentProps } from "solid-js";
import { splitProps } from "solid-js";

import clsx from "clsx";

// TODO: Allow all `div` props

const Card = (props: ParentProps & { class?: string }) => (
	<div
		class={clsx(
			"rounded-xl border border-zinc-200 text-zinc-950 shadow dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50",
			props.class,
		)}
	>
		{props.children}
	</div>
);

const CardHeader = (props: ParentProps & { class?: string }) => (
	<div class={clsx("flex flex-col space-y-1.5 p-6", props.class)}>
		{props.children}
	</div>
);

const CardTitle = (props: ParentProps & { class?: string }) => (
	<div class={clsx("font-semibold leading-none tracking-tight", props.class)}>
		{props.children}
	</div>
);

const CardDescription = (props: ParentProps & { class?: string }) => (
	<div class={clsx("text-sm text-zinc-500 dark:text-zinc-400", props.class)}>
		{props.children}
	</div>
);

const CardContent = (props: ParentProps & { class?: string }) => (
	<div class={clsx("p-6 pt-0", props.class)}>{props.children}</div>
);

const CardFooter = (props: ParentProps & { class?: string }) => (
	<div class={clsx("flex items-center p-6 pt-0", props.class)}>
		{props.children}
	</div>
);

// const Card: Component<ComponentProps<"div">> = (props) => {
// 	const [, rest] = splitProps(props, ["class"]);
// 	return (
// 		<div
// 			class={clsx(
// 				"bg-card text-card-foreground rounded-lg border shadow-sm",
// 				props.class,
// 			)}
// 			{...rest}
// 		/>
// 	);
// };

// const CardHeader: Component<ComponentProps<"div">> = (props) => {
// 	const [, rest] = splitProps(props, ["class"]);
// 	return (
// 		<div class={clsx("flex flex-col space-y-1.5 p-6", props.class)} {...rest} />
// 	);
// };

// const CardTitle: Component<ComponentProps<"h3">> = (props) => {
// 	const [, rest] = splitProps(props, ["class"]);
// 	return (
// 		<h3
// 			class={clsx(
// 				"text-lg font-semibold leading-none tracking-tight",
// 				props.class,
// 			)}
// 			{...rest}
// 		/>
// 	);
// };

// const CardDescription: Component<ComponentProps<"p">> = (props) => {
// 	const [, rest] = splitProps(props, ["class"]);
// 	return (
// 		<p class={clsx("text-muted-foreground text-sm", props.class)} {...rest} />
// 	);
// };

// const CardContent: Component<ComponentProps<"div">> = (props) => {
// 	const [, rest] = splitProps(props, ["class"]);
// 	return <div class={clsx("p-6 pt-0", props.class)} {...rest} />;
// };

// const CardFooter: Component<ComponentProps<"div">> = (props) => {
// 	const [, rest] = splitProps(props, ["class"]);
// 	return (
// 		<div class={clsx("flex items-center p-6 pt-0", props.class)} {...rest} />
// 	);
// };

export {
	Card,
	CardHeader,
	CardFooter,
	CardTitle,
	CardDescription,
	CardContent,
};
