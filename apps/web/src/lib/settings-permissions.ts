import type { Permission } from "@mattrax/enterprise-domain/client";

/**
 * Permission maps for tenant sections and settings tabs.
 *
 * Plain module (no JSX) so the maps can be unit tested without loading the
 * dashboard's Solid runtime. Re-exported from `~/lib/permissions`.
 */

/**
 * Moving a tenant between deployments needs either side of the operation:
 * export for the source, import for the target. Neither implies device access.
 */
export const MIGRATION_MOVE_PERMISSIONS: ReadonlyArray<Permission> = [
  "tenant.export",
  "tenant.import",
];

/** The cohort tracker and the deployment tools share one rail entry. */
export const MIGRATION_ACCESS_PERMISSIONS: ReadonlyArray<Permission> = [
  "devices.read",
  ...MIGRATION_MOVE_PERMISSIONS,
];

/**
 * Read permission for a settings tab.
 *
 * This is the tab's headline requirement, kept for single-permission callers.
 * Use `settingsTabPermissions` when a tab accepts alternatives (Migration
 * accepts device read *or* tenant export/import).
 */
export function settingsTabPermission(tab: string): Permission {
  switch (tab) {
    case "administrators":
      return "members.read";
    case "backups":
      return "backups.read";
    case "approvals":
      // Requesters without the queue permission still need to see and cancel
      // their own requests, so the tab is open to every member. The page and
      // API hide the full queue behind approvals.read.
      return "tenant.read";
    case "identity":
      return "identity.read";
    case "enrollment":
      return "enrollment.read";
    case "management":
    case "delivery":
      return "management.read";
    case "integrations":
      return "webhooks.read";
    case "audit":
      return "audit.read";
    case "os-updates":
    case "migration":
      return "devices.read";
    case "billing":
      return "billing.read";
    default:
      return "tenant.read";
  }
}

/**
 * All permissions that make a settings tab readable. Most tabs have one
 * requirement; Migration is visible to device readers and to the roles that
 * can move a tenant even when they cannot browse devices.
 */
export function settingsTabPermissions(tab: string): ReadonlyArray<Permission> {
  if (tab === "migration") return MIGRATION_ACCESS_PERMISSIONS;

  return [settingsTabPermission(tab)];
}

/** Read permission for each primary tenant section. */
export function tenantSectionPermission(section: string): Permission | undefined {
  switch (section) {
    case "overview":
      return "tenant.read";
    case "dashboards":
      return "dashboards.read";
    case "devices":
    case "os-versions":
      return "devices.read";
    case "users":
      return "members.read";
    case "groups":
      return "groups.read";
    case "policies":
      return "policies.read";
    case "applications":
      return "applications.read";
    case "scripts":
      return "scripts.read";
    case "settings":
      return "tenant.read";
    default:
      return undefined;
  }
}

/**
 * Resolve the permission required by a tenant path.
 *
 * Returns `undefined` for paths that gate themselves because their access rule
 * is a union the guard cannot express (Settings → Migration → Export / import
 * accepts tenant.export or tenant.import). Unknown paths also fall through
 * instead of becoming accidentally locked.
 */
export function permissionForTenantPath(path: string, tenantId: string): Permission | undefined {
  const base = `/t/${tenantId}`;

  if (path === base || path === `${base}/`) return "tenant.read";

  const rest = path.slice(base.length).replace(/^\//, "");

  if (!rest) return "tenant.read";

  const [section, sub, detail] = rest.split("/");

  if (section === "settings") {
    if (sub === undefined) return "tenant.read";

    // The export page accepts tenant.export *or* tenant.import and renders its
    // own denial, so the single-permission guard must not pick one of them.
    if (sub === "migration" && detail === "export") return undefined;

    // Backups renders its own no-access notice and gates the preload on
    // backups.read, so a role without it should see that notice rather than
    // the generic section-denied card.
    if (sub === "backups") return undefined;

    return settingsTabPermission(sub);
  }

  if (section === "software") return "applications.read";

  if (section === "dashboards" && sub) return "dashboards.read";

  return section ? tenantSectionPermission(section) : undefined;
}
