import type { ValidComponent } from "solid-js";
import { createSignal, onMount, splitProps } from "solid-js";

import { type PolymorphicProps, Tabs as TabsPrimitive } from "@kobalte/core";
import type {
	TabsContentProps,
	TabsIndicatorProps,
	TabsListProps,
	TabsTriggerProps,
} from "@kobalte/core/tabs";

import clsx from "clsx";

const Tabs = TabsPrimitive.Root;

const TabsList = <T extends ValidComponent = "div">(
	props: PolymorphicProps<T, TabsListProps>,
) => {
	const [local, rest] = splitProps(props as any, ["class", "children"]);
	return (
		<TabsPrimitive.List
			class={clsx(
				"relative bg-muted text-muted-foreground inline-flex h-10 items-center justify-center rounded-md p-1",
				props.class,
			)}
			{...rest}
		>
			{local.children}
			<TabsIndicator />
		</TabsPrimitive.List>
	);
};

// TODO: Should we keep this?
const TabsList2 = <T extends ValidComponent = "div">(
	props: PolymorphicProps<T, TabsListProps>,
) => {
	const [local, rest] = splitProps(props as any, ["class", "children"]);
	return (
		<div class="border-b border-gray-200">
			<TabsPrimitive.List
				class={clsx("-mb-px flex space-x-8", props.class)}
				{...rest}
			>
				{local.children}
			</TabsPrimitive.List>
		</div>
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
			class={clsx(
				"peer z-[2] data-[selected]:text-foreground inline-flex items-center justify-center whitespace-nowrap px-3 py-1.5 text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 outline-none",
				local.class,
			)}
			{...rest}
		/>
	);
};

// TODO: Should we keep this?
const TabsTrigger2 = <T extends ValidComponent = "button">(
	props: PolymorphicProps<T, TabsTriggerProps>,
) => {
	const [local, rest] = splitProps(
		props as PolymorphicProps<"button", TabsTriggerProps>,
		["class"],
	);
	return (
		<TabsPrimitive.Trigger
			class={clsx(
				"whitespace-nowrap border-b-2 border-transparent px-1 py-4 text-sm font-medium text-gray-500 hover:border-gray-300 hover:text-gray-700 data-[selected]:border-blue-500 data-[selected]:text-blue-600",
				// "peer z-[2] data-[selected]:text-foreground inline-flex items-center justify-center whitespace-nowrap px-3 py-1.5 text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 outline-none",
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
			class={clsx(
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

	const [mounted, setMounted] = createSignal(false);

	// Wait for the first render + a microtask to finish before animating the indicator
	onMount(() => setTimeout(() => setMounted(true), 100));

	return (
		<TabsPrimitive.Indicator
			classList={{ "duration-250ms transition-all": mounted() }}
			class={clsx(
				"z-[1] absolute rounded-sm shadow-sm inset-y-1 left-0",
				"bg-background ring-offset-2 ring-offset-background peer-focus-visible:ring-ring peer-focus-visible:ring-2",
				props.class,
			)}
			{...rest}
		/>
	);
};

export {
	Tabs,
	TabsList,
	TabsList2,
	TabsTrigger,
	TabsTrigger2,
	TabsContent,
	TabsIndicator,
};
