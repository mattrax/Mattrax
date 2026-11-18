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
        "relative inline-flex h-7 items-center gap-0.5 rounded-[7px] border border-border bg-surface p-0.5",
        local.class,
      )}
      {...others}
    >
      <SegmentedControlIndicator class="absolute inset-y-0.5 rounded-[5px] bg-card shadow-[0_1px_2px_rgb(24_24_22/0.08)] transition-none" />
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
        "relative z-10 inline-flex h-6 items-center justify-center rounded-[5px] px-2.5 text-[11.5px] font-[520] text-muted-foreground outline-none transition-colors",
        "hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/25 data-checked:text-foreground data-disabled:opacity-45",
        local.class,
      )}
      {...others}
    />
  );
}

export {
  SegmentedControl,
  SegmentedControlItemBox as SegmentedControlItem,
};
