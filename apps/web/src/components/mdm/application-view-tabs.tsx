import { For } from "solid-js";
import { routes } from "~/lib/routes";

export type ApplicationView = "applications" | "catalogue";

/** The two surfaces over the same delivery pipeline: the tenant's entries and
 * the vendor catalogue they are added from. */
export default function ApplicationViewTabs(props: { tenantId: string; active: ApplicationView }) {
  const tabs = () => [
    {
      id: "applications" as const,
      label: "Applications",
      href: routes.tenant(props.tenantId).applications(),
    },
    {
      id: "catalogue" as const,
      label: "Catalogue",
      href: routes.tenant(props.tenantId).softwareCatalogue(),
    },
  ];

  return (
    <nav
      aria-label="Application views"
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
                  ? "relative flex h-8 shrink-0 items-center gap-1.5 rounded-t-md border-b-2 border-brand px-2.5 text-xs font-medium text-foreground transition-colors duration-(--duration-hover) ease-swift"
                  : "relative flex h-8 shrink-0 items-center gap-1.5 rounded-t-md border-b-2 border-transparent px-2.5 text-xs font-medium text-muted-foreground transition-colors duration-(--duration-hover) ease-swift hover:bg-muted/50 hover:text-foreground"
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
