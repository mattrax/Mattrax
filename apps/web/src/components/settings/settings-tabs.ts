/**
 * The settings rail's tab metadata and path helpers.
 *
 * Kept free of components so the settings rail, the command palette and tests
 * all agree on the same ids, grouping, labels and active-tab rules.
 */

export type SettingsTabId =
  | ""
  | "administrators"
  | "approvals"
  | "identity"
  | "enrollment"
  | "attributes"
  | "management"
  | "migration"
  | "backups"
  | "delivery"
  | "os-updates"
  | "integrations"
  | "audit"
  | "billing"
  | "storage"
  | "legal";

/** The rail's section headings, in reading order. */
export type SettingsTabGroup = "Tenant" | "Access" | "Fleet" | "Organisation";

export type SettingsTab = {
  readonly id: SettingsTabId;
  readonly label: string;
  readonly group: SettingsTabGroup;
  readonly description: string;
};

export const SETTINGS_TAB_GROUP_ORDER: ReadonlyArray<SettingsTabGroup> = [
  "Tenant",
  "Access",
  "Fleet",
  "Organisation",
];

export const SETTINGS_TABS: ReadonlyArray<SettingsTab> = [
  {
    id: "",
    label: "General",
    group: "Tenant",
    description:
      "See the tenant ID, rename the tenant, set the branding people see, and delete it.",
  },
  {
    id: "administrators",
    label: "Administrators",
    group: "Tenant",
    description: "Invite administrators, assign roles, and review pending invitations.",
  },
  {
    id: "backups",
    label: "Backups",
    group: "Tenant",
    description:
      "Daily snapshots of this tenant, with download, restore, pinning and retention controls.",
  },
  {
    id: "approvals",
    label: "Approvals",
    group: "Access",
    description:
      "Require a second administrator before destructive actions run, and review the approval queue.",
  },
  {
    id: "identity",
    label: "Identity",
    group: "Access",
    description: "Single sign-on, SCIM provisioning, and the domains that route sign-in.",
  },
  {
    id: "enrollment",
    label: "Enrollment",
    group: "Access",
    description: "Choose which platforms can enroll, and control the enrollment link.",
  },
  {
    id: "attributes",
    label: "Attributes",
    group: "Access",
    description: "Define the custom fields your organisation tracks on every device.",
  },
  {
    id: "management",
    label: "Management",
    group: "Fleet",
    description: "Fleet integrations: Apple push, ABM, Apps and Books, Android and Windows.",
  },
  {
    id: "migration",
    label: "Migration",
    group: "Fleet",
    description:
      "Track a fleet leaving Jamf, Intune or Kandji, or move this tenant to another deployment.",
  },
  {
    id: "delivery",
    label: "Delivery",
    group: "Fleet",
    description: "Check that notification delivery to devices is healthy.",
  },
  {
    id: "os-updates",
    label: "OS updates",
    group: "Fleet",
    description: "Set minimum OS versions, enforcement and the window devices get to update.",
  },
  {
    id: "integrations",
    label: "Integrations",
    group: "Organisation",
    description: "Send tenant events to webhooks you control.",
  },
  {
    id: "audit",
    label: "Audit log",
    group: "Organisation",
    description: "Every change made in this tenant, newest first.",
  },
  {
    id: "billing",
    label: "Billing",
    group: "Organisation",
    description: "Plan, usage and invoices for this tenant.",
  },
  {
    id: "storage",
    label: "Storage",
    group: "Organisation",
    description:
      "See what this tenant stores in Mattrax, how it splits by category, and what is worth cleaning up.",
  },
  {
    id: "legal",
    label: "Legal",
    group: "Organisation",
    description: "Open-source licences and the notices those projects require.",
  },
];

export function settingsTabById(id: string): SettingsTab | undefined {
  return SETTINGS_TABS.find((tab) => tab.id === id);
}

/** The tab the settings path is showing; unknown subpaths fall back to General. */
export function activeSettingsTab(pathname: string, base: string): SettingsTabId {
  if (!pathname.startsWith(base)) return "";

  const segment = pathname
    .slice(base.length)
    .replace(/^\//, "")
    .split("/")[0];

  return SETTINGS_TABS.find((tab) => tab.id === segment)?.id ?? "";
}

export function settingsTabHref(base: string, id: SettingsTabId): string {
  return id ? `${base}/${id}` : base;
}

/** Group the visible tabs for the rail without losing the declared order. */
export function groupSettingsTabs(
  tabs: ReadonlyArray<SettingsTab>,
): ReadonlyArray<{ group: SettingsTabGroup; tabs: ReadonlyArray<SettingsTab> }> {
  return SETTINGS_TAB_GROUP_ORDER.flatMap((group) => {
    const items = tabs.filter((tab) => tab.group === group);

    return items.length > 0 ? [{ group, tabs: items }] : [];
  });
}

/** Migration's own tabs: the cohort tracker and the move-deployment tools. */
export type MigrationTabId = "" | "export";

export const MIGRATION_TABS: ReadonlyArray<{ id: MigrationTabId; label: string }> = [
  { id: "", label: "Cohorts" },
  { id: "export", label: "Export / import" },
];

export function migrationTabHref(base: string, id: MigrationTabId): string {
  return id ? `${base}/${id}` : base;
}

/**
 * Where the rail's Migration entry should land. A role that can move a tenant
 * but cannot browse devices has no cohort tracker, so it goes straight to the
 * deployment tools instead of a denied Cohorts page.
 */
export function migrationLandingHref(
  settingsBase: string,
  access: { cohorts: boolean; move: boolean },
): string {
  const base = `${settingsBase}/migration`;

  return !access.cohorts && access.move ? `${base}/export` : base;
}

/**
 * Cohort detail pages keep the Cohorts tab selected, so the bar does not blank
 * out when an operator opens a single migration.
 */
export function activeMigrationTab(pathname: string, base: string): MigrationTabId {
  if (!pathname.startsWith(base)) return "";

  const segment = pathname
    .slice(base.length)
    .replace(/^\//, "")
    .split("/")[0];

  return segment === "export" ? "export" : "";
}
