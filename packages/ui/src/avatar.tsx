import type { Component, ValidComponent } from "solid-js";
import { splitProps } from "solid-js";
import { Image as ImagePrimitive, type PolymorphicProps } from "@kobalte/core";
import type {
	ImageFallbackProps,
	ImageImgProps,
	ImageRootProps,
} from "@kobalte/core/image";

import { cn } from "./lib";

const Avatar = <T extends ValidComponent = "span">(
	props: PolymorphicProps<T, ImageRootProps>,
) => {
	const [, rest] = splitProps(props as any, ["class"]);
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

const AvatarImage = <T extends ValidComponent = "img">(
	props: PolymorphicProps<T, ImageImgProps>,
) => {
	const [, rest] = splitProps(props as any, ["class"]);
	return (
		<ImagePrimitive.Img
			class={cn("aspect-square h-full w-full", props.class)}
			{...rest}
		/>
	);
};

const AvatarFallback = <T extends ValidComponent = "span">(
	props: PolymorphicProps<T, ImageFallbackProps>,
) => {
	const [, rest] = splitProps(props as any, ["class"]);
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
