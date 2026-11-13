import { useLocation, useNavigate, useParams } from "@solidjs/router";
import { For, type ParentProps } from "solid-js";
import { PageHeader } from "~/components/mdm/common";
import { cn } from "~/lib/utils";

const tabs = [
  { id: "", label: "General" },
  { id: "administrators", label: "Members" },
  { id: "identity", label: "Identity" },
  { id: "enrollment", label: "Enrollment" },
  { id: "management", label: "Management" },
  { id: "integrations", label: "Integrations" },
  { id: "audit", label: "Audit log" },
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
    <div class="mx-auto flex w-full max-w-[1180px] flex-1 flex-col px-4 pb-8 pt-5 sm:px-6 sm:pt-6 lg:px-8 lg:pt-8">
      <PageHeader
        eyebrow="Workspace"
        title="Settings"
        description="Manage your workspace, enrollment, identity and integrations."
      />
      <nav
        class="no-scrollbar -mb-px mt-5 flex gap-0.5 overflow-x-auto border-b border-white/[0.07]"
        aria-label="Tenant settings sections"
      >
        <For each={tabs}>
          {(tab) => {
            const href = tab.id ? `${base()}/${tab.id}` : base();
            const isActive = () => active() === tab.id;
            return (
              <button
                type="button"
                onClick={() => navigate(href)}
                class={cn(
                  "relative -mb-px shrink-0 whitespace-nowrap rounded-t-md px-2.5 pb-2.5 pt-2 text-[12.5px] font-medium transition-colors",
                  isActive()
                    ? "text-foreground after:absolute after:inset-x-2 after:bottom-0 after:h-[2px] after:rounded-full after:bg-brand"
                    : "text-muted-foreground hover:bg-white/[0.03] hover:text-foreground",
                )}
                aria-current={isActive() ? "page" : undefined}
              >
                {tab.label}
              </button>
            );
          }}
        </For>
      </nav>
      <div class="flex-1 pt-5 sm:pt-6">{props.children}</div>
    </div>
  );
}
