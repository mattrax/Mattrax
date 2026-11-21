import type { ComponentProps, JSX } from "@solidjs/web";
import {
  Tooltip as TooltipPrimitive,
  TooltipContent,
  TooltipTrigger as TooltipTriggerPrimitive,
} from "@ui-sdk/solid/tooltip";
import { splitProps } from "./lib/solid";
import { cn } from "./lib/cn";

type TooltipProps = ComponentProps<typeof TooltipPrimitive> & { children?: JSX.Element };

function Tooltip(props: TooltipProps) {
  return <TooltipPrimitive delay={300} {...props} />;
}

type TooltipTriggerProps = ComponentProps<typeof TooltipTriggerPrimitive> & {
  /** A span keeps inline content out of a button; a button is the default. */
  as?: "button" | "span";
};

function TooltipTrigger(props: TooltipTriggerProps) {
  const [local, others] = splitProps(props, ["as"]);

  return (
    <TooltipTriggerPrimitive
      render={local.as === "span" ? (partProps) => <span {...partProps} /> : undefined}
      {...others}
    />
  );
}

function TooltipContentBox(
  props: ComponentProps<typeof TooltipContent> & { class?: string; children?: JSX.Element },
) {
  const [local, others] = splitProps(props, ["class", "children"]);

  return (
    <TooltipContent
      sideOffset={8}
      class={cn(
        "z-[80] max-w-64 rounded-[6px] border border-border bg-popover px-2 py-1.5 text-[11.5px] leading-4 text-popover-foreground shadow-popover outline-none",
        "origin-[var(--ui-popup-transform-origin,top)] transition-[opacity,transform] duration-[var(--duration-hover)] ease-swift data-[starting-style]:translate-y-0.5 data-[starting-style]:opacity-0 data-[ending-style]:translate-y-0.5 data-[ending-style]:opacity-0",
        local.class,
      )}
      {...others}
    >
      {local.children}
    </TooltipContent>
  );
}

export { Tooltip, TooltipContentBox as TooltipContent, TooltipTrigger };
