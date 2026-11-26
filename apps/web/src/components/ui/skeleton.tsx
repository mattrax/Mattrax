import type { ComponentProps } from "@solidjs/web";
import { Skeleton as SkeletonPrimitive } from "@mattrax/ui";

export default function Skeleton(props: ComponentProps<typeof SkeletonPrimitive>) {
  return <SkeletonPrimitive {...props} />;
}
