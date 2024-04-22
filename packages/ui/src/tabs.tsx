import type { Component } from "solid-js";
import { splitProps } from "solid-js";

import { Tabs as TabsPrimitive } from "@kobalte/core";

import { cn } from "./lib";

const Tabs = TabsPrimitive.Root;

const TabsList: Component<TabsPrimitive.TabsListProps> = (props) => {
	const [, rest] = splitProps(props, ["class"]);
	return (
		<TabsPrimitive.List
			class={cn(
				"peer relative bg-muted text-muted-foreground inline-flex h-10 items-center justify-center rounded-md p-1",
				props.class,
			)}
			{...rest}
		/>
	);
};

const TabsTrigger: Component<TabsPrimitive.TabsTriggerProps> = (props) => {
	const [, rest] = splitProps(props, ["class"]);
	return (
		<TabsPrimitive.Trigger
			class={cn(
				"z-[2] data-[selected]:text-foreground inline-flex items-center justify-center whitespace-nowrap px-3 py-1.5 text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 outline-none",
				props.class,
			)}
			{...rest}
		/>
	);
};

const TabsContent: Component<TabsPrimitive.TabsContentProps> = (props) => {
	const [, rest] = splitProps(props, ["class"]);
	return (
		<TabsPrimitive.Content
			class={cn(
				"ring-offset-background focus-visible:ring-ring mt-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
				props.class,
			)}
			{...rest}
		/>
	);
};

const TabsIndicator: Component<TabsPrimitive.TabsIndicatorProps> = (props) => {
	const [, rest] = splitProps(props, ["class"]);
	return (
		<TabsPrimitive.Indicator
			class={cn(
				"z-[1] duration-250ms absolute transition-all rounded-sm shadow-sm inset-y-1 left-0",
				"bg-background ring-offset-2 ring-offset-background peer-has-[:focus-visible]:ring-ring peer-has-[:focus-visible]:ring-2",
				props.class,
			)}
			{...rest}
		/>
	);
};

export { Tabs, TabsList, TabsTrigger, TabsContent, TabsIndicator };
