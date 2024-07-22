import { Image as ImagePrimitive, type PolymorphicProps } from "@kobalte/core";
import type {
	ImageFallbackProps,
	ImageImgProps,
	ImageRootProps,
} from "@kobalte/core/image";
import type { ValidComponent } from "solid-js";
import { splitProps } from "solid-js";

import clsx from "clsx";

const Avatar = <T extends ValidComponent = "span">(
	props: PolymorphicProps<T, ImageRootProps>,
) => {
	const [, rest] = splitProps(props as any, ["class"]);
	return (
		<ImagePrimitive.Root
			class={clsx(
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
			class={clsx("aspect-square h-full w-full", props.class)}
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
			class={clsx(
				"bg-muted flex h-full w-full items-center justify-center rounded-full select-none",
				props.class,
			)}
			{...rest}
		/>
	);
};

export { Avatar, AvatarImage, AvatarFallback };
