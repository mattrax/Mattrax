import type { Component, ValidComponent } from "solid-js";
import { splitProps } from "solid-js";

import {
	HoverCard as HoverCardPrimitive,
	type PolymorphicProps,
} from "@kobalte/core";
import type { HoverCardContentProps } from "@kobalte/core/hover-card";

import { cn } from "./lib";

const HoverCard: Component<HoverCardPrimitive.HoverCardRootProps> = (props) => {
	return <HoverCardPrimitive.Root gutter={4} {...props} />;
};

const HoverCardTrigger = HoverCardPrimitive.Trigger;

const HoverCardContent = <T extends ValidComponent = "div">(
	props: PolymorphicProps<T, HoverCardContentProps>,
) => {
	const [, rest] = splitProps(props as any, ["class"]);
	return (
		<HoverCardPrimitive.Portal>
			<HoverCardPrimitive.Content
				class={cn(
					"bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 w-64 rounded-md border p-4 shadow-md outline-none",
					props.class,
				)}
				{...rest}
			/>
		</HoverCardPrimitive.Portal>
	);
};

export { HoverCard, HoverCardTrigger, HoverCardContent };
