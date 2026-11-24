import type { Permission } from "@mattrax/enterprise-domain/client";

/**
 * Read permission for a settings tab.
 *
 * Plain module (no JSX) so the mapping can be unit tested without loading the
 * dashboard's Solid runtime. Re-exported from `~/lib/permissions`.
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
