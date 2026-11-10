import { useLocation, useNavigate, useParams } from "@solidjs/router";
import { For, type ParentProps } from "solid-js";
import { cn } from "~/lib/utils";

const tabs = [
  { id: "", label: "Overview" },
  { id: "directory", label: "Directory sync" },
  { id: "domains", label: "Domains" },
];

export default function IdentitySettingsLayout(props: ParentProps) {
  const params = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const base = () => `/t/${params.tenantId}/settings/identity`;
  const active = () => {
    const rest = location.pathname.slice(base().length).replace(/^\//, "");
    return rest.split("/")[0] ?? "";
  };
  return (
    <div class="flex flex-col gap-5">
      <nav class="flex gap-1 border-b" aria-label="Identity sections">
        <For each={tabs}>
          {(tab) => {
            const href = tab.id ? `${base()}/${tab.id}` : base();
            const isActive = () => active() === tab.id;
            return (
              <button
                type="button"
                onClick={() => navigate(href)}
                class={cn(
                  "relative whitespace-nowrap px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-stone-900",
                  isActive() && "text-stone-900",
                )}
                aria-current={isActive() ? "page" : undefined}
              >
                {tab.label}
                <span
                  class={cn(
                    "absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-stone-900",
                    isActive() ? "opacity-100" : "opacity-0",
                  )}
                />
              </button>
            );
          }}
        </For>
      </nav>
      {props.children}
    </div>
  );
}
