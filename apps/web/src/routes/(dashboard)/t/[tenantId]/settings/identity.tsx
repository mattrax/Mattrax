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
    <div class="flex flex-col gap-5">
      <nav
        class="no-scrollbar -mx-1 flex gap-1 overflow-x-auto px-1 sm:mx-0 sm:w-fit sm:rounded-lg sm:border sm:border-border sm:bg-surface sm:p-1"
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
                  "relative shrink-0 whitespace-nowrap rounded-md px-2.5 py-1.5 text-[12.5px] font-medium transition-colors",
                  isActive()
                    ? "bg-hover text-foreground shadow-[var(--card-highlight)]"
                    : "text-muted-foreground hover:bg-hover hover:text-foreground",
                )}
                aria-current={isActive() ? "page" : undefined}
              >
                {tab.label}
              </a>
            );
          }}
        </For>
      </nav>
      <div class="flex min-w-0 flex-col">{props.children}</div>
    </div>
  );
}
