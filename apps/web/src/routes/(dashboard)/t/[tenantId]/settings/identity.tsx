import { useLocation, useParams } from "@solidjs/router";
import { For } from "solid-js";
import type { ParentProps } from "solid-js";
import { useCan } from "~/lib/permissions";
import { cn } from "~/lib/utils";

const tabs = [
  { id: "", label: "Overview" },
  { id: "directory", label: "Directory sync" },
  { id: "domains", label: "Domains" },
];

export default function IdentitySettingsLayout(props: ParentProps) {
  const params = useParams();
  const location = useLocation();
  const { can } = useCan();
  const base = () => `/t/${params.tenantId}/settings/identity`;
  const visibleTabs = () => tabs.filter(() => can("identity.read"));

  const active = () => {
    const rest = location.pathname.slice(base().length).replace(/^\//, "");

    return rest.split("/")[0] ?? "";
  };

  return (
    <div class="flex flex-col">
      {/* The tab band cancels the pane gutter so it reads as part of the body
          above the sections, then re-adds the same gutter to align its labels. */}
      <nav
        class="no-scrollbar -mx-4 -mt-5 flex gap-5 overflow-x-auto border-b border-border px-4 sm:-mx-6 sm:-mt-6 sm:px-6 xl:-mx-8 xl:-mt-7 xl:px-8"
        aria-label="Identity sections"
      >
        <For each={visibleTabs()}>
          {(tab) => {
            const href = tab.id ? `${base()}/${tab.id}` : base();
            const isActive = () => active() === tab.id;

            return (
              <a
                href={href}
                class={cn(
                  "-mb-px inline-flex h-10 shrink-0 items-center rounded-sm border-b-2 px-0.5 text-[12.5px] font-[500] whitespace-nowrap outline-none transition-colors duration-[var(--duration-hover)] ease-swift focus-visible:ring-2 focus-visible:ring-ring/40",
                  isActive()
                    ? "border-foreground text-foreground"
                    : "border-transparent text-muted-foreground hover:border-border-strong hover:text-foreground",
                )}
                aria-current={isActive() ? "page" : undefined}
              >
                {tab.label}
              </a>
            );
          }}
        </For>
      </nav>
      <div class="flex min-w-0 flex-col pt-5">{props.children}</div>
    </div>
  );
}
