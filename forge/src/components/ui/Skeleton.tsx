import { JSX } from "solid-js";
import { cn } from "~/utils";

export function Skeleton(props: JSX.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      class={cn(
        "animate-pulse rounded-md bg-slate-100 dark:bg-slate-800",
        props.class
      )}
      {...props}
    />
  );
}
