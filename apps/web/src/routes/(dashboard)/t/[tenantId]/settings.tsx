import { useLocation, useNavigate, useParams } from "@solidjs/router";
import { For, type ParentProps } from "solid-js";
import { PageHeader } from "~/components/mdm/common";
import { cn } from "~/lib/utils";

const tabs = [
  { id: "", label: "General" },
  { id: "administrators", label: "Administrators" },
  { id: "identity", label: "Identity" },
  { id: "enrollment", label: "Enrollment" },
  { id: "management", label: "Management" },
  { id: "billing", label: "Billing" },
];

export default function TenantSettingsLayout(props: ParentProps) {
  const params = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const base = () => `/t/${params.tenantId}/settings`;
  const active = () => {
    const rest = location.pathname.slice(base().length).replace(/^\//, "");
    return rest.split("/")[0] ?? "";
  };

  return (
    <div class="flex flex-1 flex-col">
      <div class="border-b bg-white px-6 pt-6">
        <PageHeader
          title="Tenant settings"
          description="Manage this tenant's identity, enrollment, and Apple management."
        />
        <nav class="mt-6 flex gap-1 overflow-x-auto" aria-label="Tenant settings sections">
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
      </div>
      <div class="flex-1 p-6">{props.children}</div>
    </div>
  );
}
