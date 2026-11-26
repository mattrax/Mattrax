import type { ComponentProps, JSX } from "@solidjs/web";
import {
  HoverCard as HoverCardPrimitive,
  HoverCardContent as HoverCardContentPrimitive,
  HoverCardTrigger as HoverCardTriggerPrimitive,
} from "@ui-sdk/solid/hover-card";
import { cn } from "./lib/cn";
import { splitProps } from "./lib/solid";

/**
 * A structured preview of where a link goes, shown while the pointer rests on
 * it or keyboard focus stays on it.
 *
 * The card is informational: the trigger keeps its normal activation (a click
 * follows the link), the card never takes focus, and closing it is never
 * required to proceed. That is what separates it from a popover or a dialog.
 * Its content must always be available by following the link.
 */
type HoverCardProps = ComponentProps<typeof HoverCardPrimitive> & { children?: JSX.Element };

function HoverCard(props: HoverCardProps) {
  // Long enough that sweeping the pointer across a table does not flash cards,
  // short enough to feel like a response to resting on the link.
  return <HoverCardPrimitive delay={400} closeDelay={120} {...props} />;
}

type HoverCardTriggerProps = ComponentProps<typeof HoverCardTriggerPrimitive> & {
  /**
   * The trigger element. Links stay links; `span` is for a preview on content
   * that has no destination of its own.
   */
  as?: "a" | "span";
};

function HoverCardTrigger(props: HoverCardTriggerProps) {
  const [local, others] = splitProps(props, ["as"]);

  return (
    <HoverCardTriggerPrimitive
      render={local.as === "span" ? (partProps) => <span {...partProps} /> : undefined}
      {...others}
    />
  );
}

type HoverCardContentProps = ComponentProps<typeof HoverCardContentPrimitive> & {
  class?: string;
  children?: JSX.Element;
};

function HoverCardContent(props: HoverCardContentProps) {
  const [local, others] = splitProps(props, ["class", "children"]);

  return (
    <HoverCardContentPrimitive
      sideOffset={8}
      collisionPadding={12}
      class={cn(
        "z-50 w-88 max-w-full overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-panel outline-none",
        // Opens from the trigger and settles in place. The global
        // reduced-motion rule keeps the fade and drops the movement.
        "origin-(--ui-popup-transform-origin,top) transition duration-150 ease-out",
        "data-[starting-style]:-translate-y-1 data-[starting-style]:scale-95 data-[starting-style]:opacity-0",
        "data-[ending-style]:-translate-y-1 data-[ending-style]:scale-95 data-[ending-style]:opacity-0",
        local.class,
      )}
      {...others}
    >
      {local.children}
    </HoverCardContentPrimitive>
  );
}

export { HoverCard, HoverCardContent, HoverCardTrigger };
