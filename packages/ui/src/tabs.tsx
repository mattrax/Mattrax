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
        "relative inline-flex h-8 items-center gap-0.5 rounded-lg border border-border bg-surface p-0.5",
        local.class,
      )}
      {...others}
    >
      {local.children}
      <TabsIndicator
        class={cn(
          "pointer-events-none absolute left-0 top-0 z-0 rounded-md bg-card shadow-card",
          "h-(--active-tab-height) w-(--active-tab-width) translate-x-(--active-tab-left) translate-y-(--active-tab-top)",
          "transition-all duration-200 ease-in-out data-[activation-direction=none]:transition-none",
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
        "relative z-10 inline-flex h-7 items-center justify-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-muted-foreground outline-none",
        "transition duration-150 ease-out active:scale-95",
        "hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/25",
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

export {
  Tabs,
  TabsIndicator,
  TabsListBox as TabsList,
  TabsPanelBox as TabsPanel,
  TabsTabItem as TabsTab,
};
