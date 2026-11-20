import { For } from "solid-js";

export type PolicyView = "overview" | "assignments" | "deployment" | "designer";

/** Links to the alternate policy surfaces, styled as a console tab strip. */
export function PolicyViewTabs(props: { base: string; active: PolicyView }) {
  const tabs = () => [
    { id: "overview" as const, label: "Overview", href: props.base },
    { id: "assignments" as const, label: "Assignments", href: `${props.base}/assignments` },
    { id: "deployment" as const, label: "Deployment", href: `${props.base}/deployment` },
    { id: "designer" as const, label: "Designer", href: `${props.base}/design` },
  ];

  return (
    <nav
      aria-label="Policy views"
      class="no-scrollbar -mb-px flex items-center gap-0.5 overflow-x-auto border-b border-border"
    >
      <For each={tabs()}>
        {(tab) => {
          const current = tab.id === props.active;

          return (
            <a
              href={tab.href}
              aria-current={current ? "page" : undefined}
              class={
                current
                  ? "relative flex h-8 shrink-0 items-center gap-1.5 rounded-t-md border-b-2 border-brand px-2.5 text-[12.5px] font-medium text-foreground transition-colors duration-[var(--duration-hover)] ease-swift"
                  : "relative flex h-8 shrink-0 items-center gap-1.5 rounded-t-md border-b-2 border-transparent px-2.5 text-[12.5px] font-medium text-muted-foreground transition-colors duration-[var(--duration-hover)] ease-swift hover:bg-muted/50 hover:text-foreground"
              }
            >
              {tab.label}
            </a>
          );
        }}
      </For>
    </nav>
  );
}
