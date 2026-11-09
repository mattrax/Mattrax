import type { ComponentProps } from "@solidjs/web";
import { splitProps } from "~/lib/solid";

import { cn } from "~/lib/utils";

const Skeleton = (props: ComponentProps<"div">) => {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <div class={cn("z-skeleton animate-pulse", local.class)} data-slot="skeleton" {...others} />
  );
};

export { Skeleton };
