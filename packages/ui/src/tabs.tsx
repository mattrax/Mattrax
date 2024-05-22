import type { Component, ValidComponent } from "solid-js";
import { splitProps } from "solid-js";

import { type PolymorphicProps, Tabs as TabsPrimitive } from "@kobalte/core";
import type {
	TabsContentProps,
	TabsIndicatorProps,
	TabsListProps,
	TabsTriggerProps,
} from "@kobalte/core/tabs";

import { cn } from "./lib";

const Tabs = TabsPrimitive.Root;

const TabsList = <T extends ValidComponent = "div">(
	props: PolymorphicProps<T, TabsListProps>,
) => {
	const [, rest] = splitProps(props as any, ["class"]);
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

const TabsTrigger = <T extends ValidComponent = "button">(
	props: PolymorphicProps<T, TabsTriggerProps>,
) => {
	const [local, rest] = splitProps(
		props as PolymorphicProps<"button", TabsTriggerProps>,
		["class"],
	);
	return (
		<TabsPrimitive.Trigger
			class={cn(
				"z-[2] data-[selected]:text-foreground inline-flex items-center justify-center whitespace-nowrap px-3 py-1.5 text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 outline-none",
				local.class,
			)}
			{...rest}
		/>
	);
};

const TabsContent = <T extends ValidComponent = "div">(
	props: PolymorphicProps<T, TabsContentProps>,
) => {
	const [local, rest] = splitProps(
		props as PolymorphicProps<"div", TabsContentProps>,
		["class"],
	);
	return (
		<TabsPrimitive.Content
			class={cn(
				"ring-offset-background focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
				local.class,
			)}
			{...rest}
		/>
	);
};

const TabsIndicator = <T extends ValidComponent = "div">(
	props: PolymorphicProps<T, TabsIndicatorProps>,
) => {
	const [, rest] = splitProps(props as any, ["class"]);
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
