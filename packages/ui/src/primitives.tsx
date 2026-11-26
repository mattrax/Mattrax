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
        "inline-flex h-5 min-w-5 items-center justify-center rounded-sm border border-border bg-surface px-1",
        "font-sans text-xs font-semibold leading-none text-muted-foreground shadow-card",
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
      class={cn("animate-pulse bg-muted rounded-md", local.class)}
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
        "inline-flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-hover text-xs font-semibold text-muted-foreground ring-1 ring-inset ring-border",
        "data-[size=sm]:size-5 data-[size=sm]:text-xs data-[size=lg]:size-9 data-[size=lg]:text-xs",
        local.class,
      )}
      {...others}
    />
  );
}

export { Avatar, Kbd, Separator, Skeleton };
