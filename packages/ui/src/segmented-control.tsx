import type { ComponentProps, JSX } from "@solidjs/web";
import { splitProps } from "./lib/solid";
import {
  SegmentedControl as SegmentedControlPrimitive,
  SegmentedControlIndicator,
  SegmentedControlItem,
} from "@ui-sdk/solid/segmented-control";
import { cn } from "./lib/cn";

type SegmentedControlProps = ComponentProps<typeof SegmentedControlPrimitive> & {
  class?: string;
  children?: JSX.Element;
};

/** A compact two-to-four option switch, used for chart ranges and view modes. */
function SegmentedControl(props: SegmentedControlProps) {
  const [local, others] = splitProps(props, ["class", "children"]);

  return (
    <SegmentedControlPrimitive
      class={cn(
        "relative inline-flex h-7 items-center gap-0.5 rounded-md border border-border bg-surface p-0.5",
        local.class,
      )}
      {...others}
    >
      <SegmentedControlIndicator class="absolute inset-y-0.5 rounded-sm bg-card shadow-card transition-none" />
      {local.children}
    </SegmentedControlPrimitive>
  );
}

type SegmentedControlItemProps = ComponentProps<typeof SegmentedControlItem> & { class?: string };

function SegmentedControlItemBox(props: SegmentedControlItemProps) {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <SegmentedControlItem
      class={cn(
        "relative z-10 inline-flex h-6 items-center justify-center rounded-sm px-2.5 text-xs font-medium text-muted-foreground outline-none transition-colors",
        "hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/25 data-checked:text-foreground data-disabled:opacity-45",
        local.class,
      )}
      {...others}
    />
  );
}

export { SegmentedControl, SegmentedControlItemBox as SegmentedControlItem };
