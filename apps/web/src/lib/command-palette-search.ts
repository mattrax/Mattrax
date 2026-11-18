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
  "Administrators",
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
  /** Fields the server matched that the row does not render. */
  readonly keywords?: ReadonlyArray<string>;
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

  if ("email" in row) {
    if ("role" in row)
      return {
        id: `administrator-${row.id}`,
        title: row.name,
        subtitle: `${row.email} · ${row.role}`,
        group: "Administrators",
        href: tenant.settingsAdministrators(),
        permission: "members.read",
        keywords: ["administrator", "admin", "account", row.role],
      };

    return {
      id: `person-${row.id}`,
      title: row.name,
      subtitle: row.email,
      group: "People",
      href: tenant.settingsDirectory(),
      permission: "members.read",
      keywords: ["directory", "person"],
    };
  }

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
      // The server also matches the identifier and `shortVersion`, which the
      // row does not render. Without these the palette's client-side filter
      // would discard legitimate hits.
      keywords: [row.bundleId, row.shortVersion].filter((value): value is string => Boolean(value)),
    };

  if ("platform" in row)
    return {
      id: `application-${row.id}`,
      title: row.name,
      subtitle: [platformLabel(row.platform), row.identifier].filter(Boolean).join(" · "),
      group: "Applications",
      href: tenant.application(row.id),
      permission: "applications.read",
      // A catalogue entry can be matched by store id alone (no bundle id).
      keywords: [row.storeId].filter((value): value is string => Boolean(value)),
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

/** Fields a palette command is filtered on: everything rendered plus keywords. */
export type SearchMatchableCommand = {
  readonly title: string;
  readonly subtitle?: string;
  readonly group: string;
  readonly keywords?: ReadonlyArray<string>;
};

/**
 * Client-side filter for palette commands.
 *
 * It must include the hidden `keywords` from `searchRowCommand`, otherwise a
 * server hit matched only by a bundle id or store id would be filtered out.
 */
export const matchesSearchTerm = (command: SearchMatchableCommand, term: string) => {
  const tokens = term.split(/\s+/).filter(Boolean);

  const haystack = [
    command.title,
    command.subtitle ?? "",
    command.group,
    ...(command.keywords ?? []),
  ]
    .join(" ")
    .toLowerCase();

  return tokens.every((token) => haystack.includes(token));
};
