import { useLocation, useParams } from "@solidjs/router";
import { createEffect, createMemo, For } from "solid-js";
import type { ParentProps } from "solid-js";
import { Dynamic } from "@solidjs/web";
import type { JSX } from "@solidjs/web";
import {
  Activity,
  ArrowRightLeft,
  BookOpen,
  Boxes,
  Download,
  HardDrive,
  KeyRound,
  LinkIcon,
  MonitorSmartphone,
  Package,
  RotateCcw,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  UsersRound,
} from "~/components/ui/icons";
import {
  MIGRATION_MOVE_PERMISSIONS,
  settingsTabPermissions,
  useCan,
} from "~/lib/permissions";
import { useUnsavedChanges } from "~/lib/unsaved-changes";
import {
  createTenantProfileDraft,
  TenantProfileDraftContext,
} from "~/components/settings/tenant-profile-draft";
import { SettingsSaveBar, SlugChangeDialog } from "~/components/settings/settings-save-bar";
import {
  activeSettingsTab,
  groupSettingsTabs,
  migrationLandingHref,
  SETTINGS_TABS,
  settingsTabById,
  settingsTabHref,
} from "~/components/settings/settings-tabs";
import type { SettingsTabId } from "~/components/settings/settings-tabs";
import { cn } from "~/lib/utils";

type SectionIcon = (props: { class?: string }) => JSX.Element;

/** Icons live by tab id so the metadata stays a plain, testable module. */
const icons: Record<SettingsTabId, SectionIcon> = {
  "": Settings,
  administrators: UsersRound,
  backups: RotateCcw,
  approvals: ShieldCheck,
  identity: KeyRound,
  enrollment: MonitorSmartphone,
  attributes: SlidersHorizontal,
  management: Boxes,
  migration: ArrowRightLeft,
  delivery: Activity,
  "os-updates": Download,
  integrations: LinkIcon,
  audit: BookOpen,
  billing: Package,
  storage: HardDrive,
  legal: ShieldCheck,
};

export default function TenantSettingsLayout(props: ParentProps) {
  const params = useParams();
  const location = useLocation();
  const { can, canAny } = useCan();
  const base = () => `/t/${params.tenantId}/settings`;
  const draft = createTenantProfileDraft(params.tenantId!);
  const unsaved = useUnsavedChanges(draft.dirty, {
    title: "Leave tenant settings?",
    description:
      "The tenant profile has changes that have not been saved. Leaving settings discards them.",
    allowNavigation: (to) => to === base() || to.startsWith(`${base()}/`),
  });
  const visibleTabs = () => SETTINGS_TABS.filter((tab) => canAny(settingsTabPermissions(tab.id)));

  const hrefFor = (id: Parameters<typeof settingsTabHref>[1]) =>
    id === "migration"
      ? migrationLandingHref(base(), {
          cohorts: can("devices.read"),
          move: MIGRATION_MOVE_PERMISSIONS.some((permission) => can(permission)),
        })
      : settingsTabHref(base(), id);

  const active = () => activeSettingsTab(location.pathname, base());

  const section = () => settingsTabById(active()) ?? SETTINGS_TABS[0];

  const groups = createMemo(() => groupSettingsTabs(visibleTabs()));

  let tabNav: HTMLElement | undefined;
  let contentPane: HTMLDivElement | undefined;
  let initialRoute = true;
  createEffect(
    () => location.pathname,
    () => {
      if (initialRoute) {
        initialRoute = false;

        return;
      }

      queueMicrotask(() => {
        tabNav
          ?.querySelector<HTMLElement>('[aria-current="page"]')
          ?.scrollIntoView({ inline: "nearest", block: "nearest" });

        // The settings pane, not the window, owns the scroll. Reset it here
        // and move focus into it so keyboard users scroll the right element.
        contentPane?.scrollTo({ top: 0 });

        // A dialog owns focus while it is open.
        if (document.querySelector('[data-slot="dialog-content"], [data-slot="command-palette"]'))
          return;

        contentPane?.focus({ preventScroll: true });
      });
    },
  );

  return (
    <TenantProfileDraftContext value={draft}>
      <div class="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden bg-page">
        <header class="flex shrink-0 flex-col gap-3 border-b border-border px-5 pb-5 pt-6 sm:px-7 sm:pb-6 sm:pt-7 lg:px-8">
          <div class="label-caps">Settings</div>
          <div class="flex flex-col gap-1.5">
            <h1 class="text-[26px] font-[580] leading-[1.1] tracking-[-0.03em] text-foreground">
              {section().label}
            </h1>
            <p class="max-w-[70ch] text-[13px] leading-6 text-muted-foreground">
              {section().description}
            </p>
          </div>
        </header>

        <div class="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] xl:grid-cols-[248px_minmax(0,1fr)] xl:grid-rows-[minmax(0,1fr)]">
          <nav
            ref={(element) => {
              tabNav = element;
            }}
            class="no-scrollbar flex min-h-0 gap-1 overflow-x-auto border-b border-border px-3 py-2.5 xl:block xl:overflow-y-auto xl:overflow-x-hidden xl:border-b-0 xl:border-r xl:px-3 xl:py-5"
            aria-label="Tenant settings sections"
          >
            <For each={groups()}>
              {(entry) => (
                <div class="contents xl:mb-5 xl:block xl:last:mb-0">
                  <div class="label-caps hidden px-2.5 pb-2 xl:block">{entry.group}</div>
                  <ul class="contents xl:block xl:space-y-[2px]">
                    <For each={entry.tabs}>
                      {(tab) => {
                        const href = hrefFor(tab.id);
                        const isActive = () => active() === tab.id;

                        return (
                          <li class="contents">
                            <a
                              href={href}
                              class={cn(
                                "group flex h-7 shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-2.5 text-[12px] font-[500] transition-colors duration-[var(--duration-hover)] ease-swift xl:h-9 xl:w-full xl:gap-2.5 xl:rounded-lg xl:px-2.5 xl:text-[13px]",
                                isActive()
                                  ? "bg-active text-foreground"
                                  : "text-muted-foreground hover:bg-hover hover:text-foreground",
                              )}
                              aria-current={isActive() ? "page" : undefined}
                            >
                              <Dynamic
                                component={icons[tab.id]}
                                class={cn(
                                  "size-3.5 shrink-0 transition-opacity xl:size-4",
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

          {/* The content column owns the scroll so the title, tab row and rail
              stay put while a long settings page moves underneath them. */}
          <div
            ref={(element) => {
              contentPane = element;
            }}
            tabindex="-1"
            class={cn(
              "settings-sections min-h-0 min-w-0 overflow-y-auto px-4 py-5 outline-none focus:outline-none sm:px-6 sm:py-6 xl:px-8 xl:py-7",
              (draft.dirty() || draft.saving() || draft.saved()) && "pb-28",
            )}
          >
            {props.children}
          </div>
        </div>

        {unsaved.prompt}
        <SettingsSaveBar draft={draft} />
        <SlugChangeDialog draft={draft} />
      </div>
    </TenantProfileDraftContext>
  );
}
