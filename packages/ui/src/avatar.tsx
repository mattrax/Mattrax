import type { Component } from "solid-js";
import { splitProps } from "solid-js";
import { Image as ImagePrimitive, type PolymorphicProps } from "@kobalte/core";
import type {
	ImageFallbackProps,
	ImageImgProps,
	ImageRootProps,
} from "@kobalte/core/image";

import { cn } from "./lib";

const Avatar: Component<PolymorphicProps<"span", ImageRootProps>> = (props) => {
	const [, rest] = splitProps(props, ["class"]);
	return (
		<ImagePrimitive.Root
			class={cn(
				"relative flex h-10 w-10 shrink-0 overflow-hidden rounded-full",
				props.class,
			)}
			{...rest}
		/>
	);
};

const AvatarImage: Component<PolymorphicProps<"img", ImageImgProps>> = (
	props,
) => {
	const [, rest] = splitProps(props, ["class"]);
	return (
		<ImagePrimitive.Img
			class={cn("aspect-square h-full w-full", props.class)}
			{...rest}
		/>
	);
};

const AvatarFallback: Component<PolymorphicProps<"span", ImageFallbackProps>> =
	(props) => {
		const [, rest] = splitProps(props, ["class"]);
		return (
			<ImagePrimitive.Fallback
				class={cn(
					"bg-muted flex h-full w-full items-center justify-center rounded-full select-none",
					props.class,
				)}
				{...rest}
			/>
		);
	};

export { Avatar, AvatarImage, AvatarFallback };
