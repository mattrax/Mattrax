import type { SearchResult } from "@mattrax/enterprise-domain/client";
import { routes } from "~/lib/routes";

/**
 * Pure mapping from a tenant search row to a command-palette entry.
 *
 * The component supplies the icon and runs the navigation; keeping the row
 * shape here means the grouping, hints and permission requirements can be
 * tested without mounting the dialog.
 */

export type SearchRow = SearchResult["rows"][number];

export const SEARCH_GROUP_ORDER = [
  "Recent",
  "This page",
  "Actions",
  "Navigation",
  "Settings",
  "Queries",
  "Devices",
  "People",
  "Groups",
  "Policies",
  "Applications",
  "Software",
] as const;

export type SearchGroup = (typeof SEARCH_GROUP_ORDER)[number];

export const groupRank = (group: string) => {
  const index = SEARCH_GROUP_ORDER.findIndex((value) => value === group);

  return index === -1 ? SEARCH_GROUP_ORDER.length : index;
};

export type SearchRowPermission =
  | "devices.read"
  | "members.read"
  | "groups.read"
  | "policies.read"
  | "applications.read";

export type SearchRowCommand = {
  readonly id: string;
  readonly title: string;
  readonly subtitle: string;
  readonly group: Exclude<
    SearchGroup,
    "Recent" | "This page" | "Actions" | "Navigation" | "Settings" | "Queries"
  >;
  readonly href: string;
  readonly permission: SearchRowPermission;
};

const PLATFORM_LABELS = {
  apple: "Apple",
  win: "Windows",
  android: "Android",
} as const;

const platformLabel = (platform: keyof typeof PLATFORM_LABELS) => PLATFORM_LABELS[platform];

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/** Map one search row to its palette entry, or `undefined` if unknown. */
export const searchRowCommand = (
  row: SearchRow,
  tenantId: string,
): SearchRowCommand | undefined => {
  const tenant = routes.tenant(tenantId);

  if ("proto" in row)
    return {
      id: `device-${row.id}`,
      title: row.name,
      subtitle: [row.serial, row.model].filter(Boolean).join(" · ") || "Device",
      group: "Devices",
      href: tenant.device(row.id),
      permission: "devices.read",
    };

  if ("email" in row)
    return {
      id: `person-${row.id}`,
      title: row.name,
      subtitle: `${row.email} · ${row.role}`,
      group: "People",
      href: tenant.settingsAdministrators(),
      permission: "members.read",
    };

  if ("devicesCount" in row)
    return {
      id: `group-${row.id}`,
      title: row.name,
      subtitle: plural(row.devicesCount ?? 0, "device"),
      group: "Groups",
      href: tenant.group(row.id),
      permission: "groups.read",
    };

  if ("deviceCount" in row)
    return {
      id: `software-${encodeURIComponent(row.bundleId)}-${encodeURIComponent(
        row.version ?? "",
      )}-${encodeURIComponent(row.publisher ?? "")}`,
      title: row.name,
      subtitle: [
        row.version ? `v${row.version}` : undefined,
        row.publisher,
        plural(row.deviceCount, "device"),
      ]
        .filter(Boolean)
        .join(" · "),
      group: "Software",
      href: tenant.software(),
      permission: "applications.read",
    };

  if ("platform" in row)
    return {
      id: `application-${row.id}`,
      title: row.name,
      subtitle: [platformLabel(row.platform), row.identifier].filter(Boolean).join(" · "),
      group: "Applications",
      href: tenant.application(row.id),
      permission: "applications.read",
    };

  if ("priority" in row)
    return {
      id: `policy-${row.id}`,
      title: row.name,
      subtitle: "Policy",
      group: "Policies",
      href: tenant.policy(row.id),
      permission: "policies.read",
    };

  return undefined;
};
