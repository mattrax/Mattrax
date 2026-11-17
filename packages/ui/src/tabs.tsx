import type { ComponentProps, JSX } from "@solidjs/web";
import { splitProps } from "./lib/solid";
import {
  Tabs as TabsPrimitive,
  TabsIndicator,
  TabsList,
  TabsPanel,
  TabsTab,
} from "@ui-sdk/solid/tabs";
import { cn } from "./lib/cn";

type TabsProps = ComponentProps<typeof TabsPrimitive> & { children?: JSX.Element };

function Tabs(props: TabsProps) {
  return <TabsPrimitive {...props} />;
}

function TabsListBox(props: ComponentProps<typeof TabsList> & { class?: string }) {
  const [local, others] = splitProps(props, ["class", "children"]);

  return (
    <TabsList
      class={cn(
        "relative inline-flex h-8 items-center gap-0.5 rounded-[8px] border border-border bg-surface p-0.5",
        local.class,
      )}
      {...others}
    >
      {local.children}
      <TabsIndicator
        class={cn(
          "pointer-events-none absolute left-0 top-0 z-0 rounded-[6px] bg-card shadow-[0_1px_2px_rgb(24_24_22/0.08)]",
          "[height:var(--active-tab-height)] [width:var(--active-tab-width)] [transform:translate(var(--active-tab-left),var(--active-tab-top))]",
          "transition-[transform,width,height] duration-200 ease-in-out data-[activation-direction=none]:transition-none",
        )}
      />
    </TabsList>
  );
}

function TabsTabItem(props: ComponentProps<typeof TabsTab> & { class?: string }) {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <TabsTab
      class={cn(
        "relative z-10 inline-flex h-7 items-center justify-center gap-1.5 rounded-[6px] px-2.5 text-[12px] font-[500] text-muted-foreground outline-none",
        "transition-[color,transform] duration-[var(--duration-hover)] ease-swift active:scale-[0.97]",
        "hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/25",
        "data-selected:text-foreground",
        local.class,
      )}
      {...others}
    />
  );
}

function TabsPanelBox(props: ComponentProps<typeof TabsPanel> & { class?: string }) {
  const [local, others] = splitProps(props, ["class"]);

  return <TabsPanel class={cn("outline-none", local.class)} {...others} />;
}

export { Tabs, TabsIndicator, TabsListBox as TabsList, TabsPanelBox as TabsPanel, TabsTabItem as TabsTab };
