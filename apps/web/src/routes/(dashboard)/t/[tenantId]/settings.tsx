import { useLocation, useParams } from "@solidjs/router";
import { createEffect, createMemo, For } from "solid-js";
import type { ParentProps } from "solid-js";
import { Dynamic } from "@solidjs/web";
import type { JSX } from "@solidjs/web";
import {
  Activity,
  BookOpen,
  Boxes,
  Download,
  KeyRound,
  LinkIcon,
  MonitorSmartphone,
  Package,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  UsersRound,
} from "~/components/ui/icons";
import { settingsTabPermission, useCan } from "~/lib/permissions";
import { cn } from "~/lib/utils";

type SectionIcon = (props: { class?: string }) => JSX.Element;

const tabs: ReadonlyArray<{
  id: string;
  label: string;
  group: string;
  icon: SectionIcon;
}> = [
  { id: "", label: "General", group: "Workspace", icon: Settings },
  { id: "administrators", label: "Administrators", group: "Workspace", icon: UsersRound },
  { id: "identity", label: "Identity", group: "Access", icon: KeyRound },
  { id: "enrollment", label: "Enrollment", group: "Access", icon: MonitorSmartphone },
  { id: "attributes", label: "Attributes", group: "Access", icon: SlidersHorizontal },
  { id: "management", label: "Management", group: "Fleet", icon: Boxes },
  { id: "delivery", label: "Delivery", group: "Fleet", icon: Activity },
  { id: "os-updates", label: "OS updates", group: "Fleet", icon: Download },
  { id: "integrations", label: "Integrations", group: "Organisation", icon: LinkIcon },
  { id: "audit", label: "Audit log", group: "Organisation", icon: BookOpen },
  { id: "billing", label: "Billing", group: "Organisation", icon: Package },
  { id: "legal", label: "Legal", group: "Organisation", icon: ShieldCheck },
];

const groupOrder = ["Workspace", "Access", "Fleet", "Organisation"] as const;

const sectionDescriptions = new Map([
  ["", "Rename the tenant, set the branding people see, and export or delete it."],
  ["administrators", "Invite administrators, assign roles, and review pending invitations."],
  ["identity", "Single sign-on, SCIM provisioning, and the domains that route sign-in."],
  ["enrollment", "Choose which platforms can enroll, and control the enrollment link."],
  ["attributes", "Define the custom fields your organisation tracks on every device."],
  ["management", "Fleet integrations: Apple push, ABM, Apps and Books, Android and Windows."],
  ["delivery", "Check that notification delivery to devices is healthy."],
  ["integrations", "Send tenant events to webhooks you control."],
  ["audit", "Every change made in this tenant, newest first."],
  ["os-updates", "Set minimum OS versions, enforcement and the window devices get to update."],
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

    return tabs.find((tab) => tab.id === id) ?? tabs[0];
  };

  const groups = createMemo(() =>
    groupOrder.flatMap((group) => {
      const items = visibleTabs().filter((tab) => tab.group === group);

      return items.length > 0 ? [{ group, items }] : [];
    }),
  );

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
    <div class="mx-auto w-full max-w-[1360px] flex-1 px-4 pb-10 pt-5 sm:px-6 sm:pt-6 lg:px-8 lg:pt-8">
      <section class="overflow-hidden rounded-2xl border border-border bg-card shadow-card">
        <header class="flex flex-col gap-3 border-b border-border px-5 pb-5 pt-6 sm:px-7 sm:pb-6 sm:pt-7 lg:px-8">
          <div class="label-caps">Settings</div>
          <div class="flex flex-col gap-1.5">
            <h1 class="text-[26px] font-[580] leading-[1.1] tracking-[-0.03em] text-foreground">
              {section().label}
            </h1>
            <p class="max-w-[70ch] text-[13px] leading-6 text-muted-foreground">
              {sectionDescriptions.get(section().id) ?? "Manage this tenant's settings."}
            </p>
          </div>
        </header>

        <div class="grid lg:grid-cols-[248px_minmax(0,1fr)]">
          <nav
            ref={(element) => {
              tabNav = element;
            }}
            class="no-scrollbar flex gap-1 overflow-x-auto border-b border-border px-3 py-2.5 lg:block lg:overflow-visible lg:border-b-0 lg:border-r lg:px-3 lg:py-5"
            aria-label="Tenant settings sections"
          >
            <For each={groups()}>
              {(entry) => (
                <div class="contents lg:mb-5 lg:block lg:last:mb-0">
                  <div class="label-caps hidden px-2.5 pb-2 lg:block">{entry.group}</div>
                  <ul class="contents lg:block lg:space-y-[2px]">
                    <For each={entry.items}>
                      {(tab) => {
                        const href = tab.id ? `${base()}/${tab.id}` : base();
                        const isActive = () => active() === tab.id;

                        return (
                          <li class="contents">
                            <a
                              href={href}
                              class={cn(
                                "group flex h-7 shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-2.5 text-[12px] font-[500] transition-colors duration-[var(--duration-hover)] ease-swift lg:h-9 lg:w-full lg:gap-2.5 lg:rounded-lg lg:px-2.5 lg:text-[13px]",
                                isActive()
                                  ? "bg-active text-foreground"
                                  : "text-muted-foreground hover:bg-hover hover:text-foreground",
                              )}
                              aria-current={isActive() ? "page" : undefined}
                            >
                              <Dynamic
                                component={tab.icon}
                                class={cn(
                                  "size-3.5 shrink-0 transition-opacity lg:size-4",
                                  isActive() ? "opacity-90" : "opacity-55",
                                )}
                              />
                              {tab.label}
                            </a>
                          </li>
                        );
                      }}
                    </For>
                  </ul>
                </div>
              )}
            </For>
          </nav>

          <div class="min-w-0 px-4 py-5 sm:px-6 sm:py-6 xl:px-8 xl:py-7">{props.children}</div>
        </div>
      </section>
    </div>
  );
}
