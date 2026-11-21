import type { ComponentProps } from "@solidjs/web";
import { splitProps } from "./lib/solid";
import { cn } from "./lib/cn";

/** A keyboard chord, e.g. ⌘K. Purely presentational; the control owns the shortcut. */
function Kbd(props: ComponentProps<"kbd">) {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <kbd
      data-slot="kbd"
      class={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-[4px] border border-border bg-surface px-1",
        "font-sans text-[10.5px] font-[560] leading-none text-muted-foreground shadow-[0_1px_0_rgb(24_24_22/0.04)]",
        local.class,
      )}
      {...others}
    />
  );
}

function Skeleton(props: Omit<ComponentProps<"div">, "style">) {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      class={cn(
        "animate-pulse rounded-md bg-[linear-gradient(90deg,var(--muted),var(--hover),var(--muted))] bg-[length:200%_100%] [animation:mt-shimmer_1.6s_linear_infinite]",
        local.class,
      )}
      {...others}
    />
  );
}

function Separator(
  props: Omit<ComponentProps<"div">, "style"> & { orientation?: "horizontal" | "vertical" },
) {
  const [local, others] = splitProps(props, ["class", "orientation"]);

  return (
    <div
      data-slot="separator"
      role="separator"
      aria-orientation={local.orientation ?? "horizontal"}
      class={cn(
        "shrink-0 bg-border",
        local.orientation === "vertical" ? "h-full w-px" : "h-px w-full",
        local.class,
      )}
      {...others}
    />
  );
}

function Avatar(props: Omit<ComponentProps<"span">, "style"> & { size?: "sm" | "default" | "lg" }) {
  const [local, others] = splitProps(props, ["class", "size"]);

  return (
    <span
      data-slot="avatar"
      data-size={local.size ?? "default"}
      class={cn(
        "inline-flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-hover text-[10px] font-[600] text-muted-foreground ring-1 ring-inset ring-border",
        "data-[size=sm]:size-5 data-[size=sm]:text-[9px] data-[size=lg]:size-9 data-[size=lg]:text-[12px]",
        local.class,
      )}
      {...others}
    />
  );
}

export { Avatar, Kbd, Separator, Skeleton };
