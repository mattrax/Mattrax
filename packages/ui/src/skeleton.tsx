import type { PolymorphicProps } from "@kobalte/core/polymorphic";
import * as SkeletonPrimitive from "@kobalte/core/skeleton";
import clsx from "clsx";
import { type ValidComponent, splitProps } from "solid-js";

type SkeletonRootProps<T extends ValidComponent = "div"> =
	SkeletonPrimitive.SkeletonRootProps<T> & { class?: string | undefined };

const Skeleton = <T extends ValidComponent = "div">(
	props: PolymorphicProps<T, SkeletonRootProps<T>>,
) => {
	const [local, others] = splitProps(props as SkeletonRootProps, ["class"]);
	return (
		<SkeletonPrimitive.Root
			class={clsx(
				"bg-primary/10 data-[animate='true']:animate-pulse ",
				local.class,
			)}
			{...others}
		/>
	);
};

export { Skeleton };
