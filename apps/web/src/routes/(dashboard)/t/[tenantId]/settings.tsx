import { useLocation, useParams } from "@solidjs/router";
import { createEffect, createMemo, For, Loading } from "solid-js";
import type { ParentProps } from "solid-js";
import { LoadingState } from "@mattrax/ui";
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
  Tag,
  UsersRound,
} from "~/components/ui/icons";
import { MIGRATION_MOVE_PERMISSIONS, settingsTabPermissions, useCan } from "~/lib/permissions";
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
  tags: Tag,
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

        // The settings pane, not the window, owns the scroll. Reset it here;
        // focus is left to the shell, which already moves it to `#main` once
        // per pathname change.
        contentPane?.scrollTo({ top: 0 });
      });
    },
  );

  return (
    <TenantProfileDraftContext value={draft}>
      <div class="grid h-full min-h-0 w-full flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[auto_auto_minmax(0,1fr)] [grid-template-areas:'masthead'_'nav'_'content'] overflow-hidden bg-page xl:grid-cols-[248px_minmax(0,1fr)] xl:grid-rows-[auto_minmax(0,1fr)] xl:[grid-template-areas:'nav_masthead'_'nav_content']">
        <header
          data-slot="settings-masthead"
          class="[grid-area:masthead] flex flex-col gap-1.5 border-b border-border px-8 py-3 sm:px-10 sm:py-4 xl:px-12"
        >
          <div class="label-caps">Settings</div>
          <div class="flex flex-col gap-1">
            <h1 class="text-[22px] font-[580] leading-[1.15] tracking-[-0.03em] text-foreground">
              {section().label}
            </h1>
            <p class="max-w-[70ch] text-[12.5px] leading-5 text-muted-foreground">
              {section().description}
            </p>
          </div>
        </header>

        <nav
          ref={(element) => {
            tabNav = element;
          }}
          data-slot="settings-navigation"
          class="no-scrollbar [grid-area:nav] flex min-h-0 gap-1 overflow-x-auto border-b border-border px-3 py-2.5 xl:block xl:overflow-y-auto xl:overflow-x-hidden xl:border-b-0 xl:border-r xl:px-3 xl:py-5"
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
          data-slot="settings-content"
          class={cn(
            "settings-sections [grid-area:content] min-h-0 min-w-0 overflow-y-auto px-4 py-3 sm:px-6 sm:py-4 xl:px-8 xl:py-4",
            (draft.dirty() || draft.saving() || draft.saved()) && "pb-28",
          )}
        >
          {/* Only the pane under the rail swaps while a settings chunk
                loads. The masthead, rail, unsaved draft and save bar stay
                mounted. */}
          <Loading
            fallback={
              <div class="flex min-h-40 items-center justify-center py-16">
                <LoadingState label="Loading section…" size={18} />
              </div>
            }
          >
            {props.children}
          </Loading>
        </div>

        {unsaved.prompt}
        <SettingsSaveBar draft={draft} />
        <SlugChangeDialog draft={draft} />
      </div>
    </TenantProfileDraftContext>
  );
}
