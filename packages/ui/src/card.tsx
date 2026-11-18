import type { ComponentProps } from "@solidjs/web";
import { splitProps } from "./lib/solid";
import { cn } from "./lib/cn";

function Card(props: ComponentProps<"div"> & { interactive?: boolean }) {
  const [local, others] = splitProps(props, ["class", "interactive"]);

  return (
    <div
      data-slot="card"
      data-interactive={local.interactive ? "" : undefined}
      class={cn(
        "flex flex-col rounded-xl border border-border bg-card text-card-foreground shadow-card",
        "data-interactive:cursor-pointer data-interactive:transition-[border-color,box-shadow,transform] data-interactive:duration-[var(--duration-hover)] data-interactive:ease-swift data-interactive:hover:border-border-strong data-interactive:hover:shadow-popover data-interactive:active:scale-[0.997]",
        local.class,
      )}
      {...others}
    />
  );
}

function CardHeader(props: ComponentProps<"div">) {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <div
      data-slot="card-header"
      class={cn(
        "grid auto-rows-min items-start gap-0.5 px-4 pt-4 has-data-[slot=card-action]:grid-cols-[1fr_auto]",
        local.class,
      )}
      {...others}
    />
  );
}

function CardTitle(props: ComponentProps<"div">) {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <div
      data-slot="card-title"
      class={cn("text-[13px] font-[560] leading-5 tracking-[-0.012em]", local.class)}
      {...others}
    />
  );
}

function CardDescription(props: ComponentProps<"div">) {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <div
      data-slot="card-description"
      class={cn("text-[12px] leading-5 text-muted-foreground", local.class)}
      {...others}
    />
  );
}

function CardAction(props: ComponentProps<"div">) {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <div
      data-slot="card-action"
      class={cn("col-start-2 row-span-2 row-start-1 self-start justify-self-end", local.class)}
      {...others}
    />
  );
}

function CardContent(props: ComponentProps<"div">) {
  const [local, others] = splitProps(props, ["class"]);

  return <div data-slot="card-content" class={cn("px-4 py-4", local.class)} {...others} />;
}

function CardFooter(props: ComponentProps<"div">) {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <div
      data-slot="card-footer"
      class={cn("flex items-center gap-2 px-4 pb-4", local.class)}
      {...others}
    />
  );
}

/** The small tracked heading above a group of cards or a card body. */
function CardLabel(props: ComponentProps<"div">) {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <div
      data-slot="card-label"
      class={cn("label-caps flex items-center gap-1.5", local.class)}
      {...others}
    />
  );
}

export {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardLabel,
  CardTitle,
};
