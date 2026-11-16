import { useLocation, useParams } from "@solidjs/router";
import { createEffect, For, type ParentProps } from "solid-js";
import { PageHeader } from "~/components/mdm/common";
import { settingsTabPermission, useCan } from "~/lib/permissions";
import { cn } from "~/lib/utils";

const tabs = [
  { id: "", label: "General" },
  { id: "administrators", label: "Members" },
  { id: "identity", label: "Identity" },
  { id: "enrollment", label: "Enrollment" },
  { id: "attributes", label: "Attributes" },
  { id: "management", label: "Management" },
  { id: "delivery", label: "Delivery" },
  { id: "integrations", label: "Integrations" },
  { id: "audit", label: "Audit log" },
  { id: "billing", label: "Billing" },
  { id: "legal", label: "Legal" },
];

const sectionDescriptions = new Map([
  ["", "Rename the tenant, set the branding people see, and export or delete it."],
  ["administrators", "Invite people, assign roles, and review pending invitations."],
  ["identity", "Single sign-on, SCIM provisioning, and the domains that route sign-in."],
  ["enrollment", "Choose which platforms can enroll, and control the enrollment link."],
  ["attributes", "Define the custom fields your organisation tracks on every device."],
  ["management", "Fleet integrations: Apple push, ABM, Apps and Books, Android and Windows."],
  ["delivery", "Check that notification delivery to devices is healthy."],
  ["integrations", "Send tenant events to webhooks you control."],
  ["audit", "Every change made in this tenant, newest first."],
  ["billing", "Plan, usage and invoices for this tenant."],
  ["legal", "Open-source licences and the notices those projects require."],
]);

export default function TenantSettingsLayout(props: ParentProps) {
  const params = useParams();
  const location = useLocation();
  const { can } = useCan();
  const base = () => `/t/${params.tenantId}/settings`;
  const visibleTabs = () => tabs.filter((tab) => can(settingsTabPermission(tab.id)));

  const active = () => {
    const rest = location.pathname.slice(base().length).replace(/^\//, "");

    return rest.split("/")[0] ?? "";
  };

  const section = () => {
    const id = active();

    return tabs.find((tab) => tab.id === id) ?? tabs[0]!;
  };

  let tabNav: HTMLElement | undefined;
  createEffect(
    () => location.pathname,
    () => {
      queueMicrotask(() => {
        tabNav
          ?.querySelector<HTMLElement>('[aria-current="page"]')
          ?.scrollIntoView({ inline: "nearest", block: "nearest" });
      });
    },
  );

  return (
    <div class="mx-auto flex w-full max-w-[1180px] flex-1 flex-col px-4 pb-8 pt-5 sm:px-6 sm:pt-6 lg:px-8 lg:pt-8">
      <PageHeader
        eyebrow="Settings"
        title={section().label}
        description={sectionDescriptions.get(section().id) ?? "Manage this tenant's settings."}
      />
      <nav
        ref={(element) => {
          tabNav = element;
        }}
        class="no-scrollbar -mb-px mt-5 flex gap-0.5 overflow-x-auto border-b border-border"
        aria-label="Tenant settings sections"
      >
        <For each={visibleTabs()}>
          {(tab) => {
            const href = tab.id ? `${base()}/${tab.id}` : base();
            const isActive = () => active() === tab.id;

            return (
              <a
                href={href}
                class={cn(
                  "relative -mb-px shrink-0 whitespace-nowrap rounded-t-md px-2.5 pb-2.5 pt-2 text-[12.5px] font-medium transition-colors",
                  isActive()
                    ? "text-foreground after:absolute after:inset-x-2 after:bottom-0 after:h-[2px] after:rounded-full after:bg-foreground"
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
      <div class="flex-1 pt-5 sm:pt-6">{props.children}</div>
    </div>
  );
}
