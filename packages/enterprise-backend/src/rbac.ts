import { Context, Effect } from "effect";
import type { EnterpriseDb } from "@mattrax/enterprise-core";
import {
  builtInRolePermissions,
  BUILT_IN_ROLE_LABELS,
  isBuiltInTenantRole,
  PERMISSION_SET,
  type Permission,
} from "@mattrax/enterprise-domain";

/** Ambient permission attached by the service proxy to one method invocation. */
export class RequiredPermission extends Context.Service<
  RequiredPermission,
  { readonly permission: Permission; readonly method: string }
>()("@mattrax/enterprise-backend/RequiredPermission") {}

const DEVICE_READ = new Set([
  "listDevices",
  "searchDevices",
  "exportDevices",
  "getDevice",
  "listDeviceApplications",
  "listDeviceCommands",
  "listDeviceDeclarations",
  "getDeviceHealth",
  "getDeviceActivity",
  "getDeviceHealthSummary",
  "getDevicePushHealth",
  "getCredentialHealth",
  "getDeviceEffectivePolicy",
  "listDevicePreRegistrations",
]);

const DEVICE_WRITE = new Set([
  "patchDevice",
  "deleteDevices",
  "deleteDevicePreRegistration",
  "deleteDevicePreRegistrations",
  "importDevicePreRegistrations",
  "deviceUnenroll",
  "revokeDeviceIdentity",
]);

const GROUP_READ = new Set(["listGroups", "getGroup", "previewGroup"]);

const GROUP_WRITE = new Set([
  "createGroup",
  "deleteGroups",
  "patchGroup",
  "patchGroupMembers",
  "syncGroups",
  "duplicateGroup",
]);

const POLICY_READ = new Set([
  "listPolicies",
  "getPolicy",
  "listPolicyDeployments",
  "getPolicyAssignments",
  "downloadPolicyApplication",
]);

const POLICY_WRITE = new Set([
  "createPolicy",
  "deletePolicies",
  "patchPolicy",
  "rollbackPolicy",
  "uploadPolicyApplication",
  "patchPolicyAssignments",
  "syncPolicies",
  "duplicatePolicy",
]);

const APPLICATION_READ = new Set([
  "listApplications",
  "getApplication",
  "getApplicationInventory",
  "downloadApplication",
]);

const APPLICATION_WRITE = new Set([
  "createApplication",
  "patchApplication",
  "deleteApplications",
  "patchApplicationAssignments",
  "installApplication",
  "uploadApplication",
]);

const DASHBOARD_READ = new Set(["listDashboards", "getDashboard", "queryDashboard"]);

const DASHBOARD_WRITE = new Set([
  "createDashboard",
  "patchDashboard",
  "deleteDashboard",
  "createDashboardWidget",
  "patchDashboardWidget",
  "deleteDashboardWidget",
  "patchDashboardLayout",
]);

const ENROLLMENT_READ = new Set([
  "getTenantEnrollment",
  "listEnrollmentAttempts",
  "getAppleEnrollmentProfile",
  "getAdeEnrollmentProfile",
]);

const ENROLLMENT_WRITE = new Set(["patchTenantEnrollment", "resetTenantEnrollment"]);

const IDENTITY_READ = new Set([
  "getSsoConfig",
  "getEntraDirectorySync",
  "listEntraDomains",
  "listScimTokens",
]);

const IDENTITY_WRITE = new Set([
  "patchSsoConfig",
  "patchEntraDirectorySync",
  "syncEntraDirectory",
  "refreshEntraDomains",
  "createScimToken",
  "revokeScimToken",
]);

const MANAGEMENT_READ = new Set([
  "getAutopilotSettings",
  "listAutopilotDevices",
  "listAutopilotProfiles",
  "getAppleBusinessManager",
  "listAbmDevices",
  "getAbmDevice",
  "getAbmDeviceProfileUrl",
  "getVpp",
  "listVppAssets",
  "listVppAssignments",
  "getTenantAndroid",
  "getApns",
  "getApnsCsr",
]);

const MANAGEMENT_WRITE = new Set([
  "importAutopilotDevices",
  "syncAutopilotDevices",
  "deleteAutopilotDevice",
  "createAutopilotProfile",
  "updateAutopilotProfile",
  "assignAutopilotProfile",
  "uploadAppleBusinessManagerToken",
  "deleteAppleBusinessManagerToken",
  "syncAppleBusinessManager",
  "assignAppleBusinessManagerDevice",
  "uploadVppToken",
  "deleteVppToken",
  "syncVpp",
  "installVppAsset",
  "releaseVppAsset",
  "patchTenantAndroid",
  "createAndroidSignup",
  "syncTenantAndroid",
  "uploadApns",
  "deleteApns",
]);

const WEBHOOK_READ = new Set(["listWebhookEndpoints"]);

const WEBHOOK_WRITE = new Set([
  "createWebhookEndpoint",
  "patchWebhookEndpoint",
  "deleteWebhookEndpoint",
  "rotateWebhookSecret",
  "testWebhookEndpoint",
]);

const MEMBER_READ = new Set(["listTenantUsers", "listTenantInvitations"]);

const MEMBER_WRITE = new Set([
  "inviteTenantUser",
  "cancelTenantInvitation",
  "patchTenantUser",
  "removeTenantUser",
]);

const ROLE_READ = new Set(["listTenantRoles"]);
const ROLE_WRITE = new Set(["createTenantRole", "patchTenantRole", "deleteTenantRole"]);

const EXPLICIT: Record<string, Permission> = {
  getTenant: "tenant.read",
  search: "tenant.read",
  patchTenant: "tenant.write",
  deleteTenant: "tenant.delete",
  exportTenant: "tenant.export",
  importTenant: "tenant.import",
  runTenantBackup: "backups.write",
  listTenantBackups: "backups.read",
  downloadTenantBackup: "backups.read",
  listAuditLog: "audit.read",
  searchAuditLog: "audit.read",
  exportAuditLog: "audit.read",
  recordMcpActivity: "audit.read",
  billing: "billing.read",
  billingPortal: "billing.write",
  deviceAction: "devices.command",
  getDeviceRecoveryKey: "devices.recovery_key",
  extractMobileconfig: "policies.read",
  previewMobileconfig: "policies.read",
};

export const permissionForMethod = (method: string): Permission | undefined => {
  if (EXPLICIT[method]) return EXPLICIT[method];

  if (DEVICE_READ.has(method)) return "devices.read";

  if (DEVICE_WRITE.has(method)) return "devices.write";

  if (GROUP_READ.has(method)) return "groups.read";

  if (GROUP_WRITE.has(method)) return "groups.write";

  if (POLICY_READ.has(method)) return "policies.read";

  if (POLICY_WRITE.has(method)) return "policies.write";

  if (APPLICATION_READ.has(method)) return "applications.read";

  if (APPLICATION_WRITE.has(method)) return "applications.write";

  if (DASHBOARD_READ.has(method)) return "dashboards.read";

  if (DASHBOARD_WRITE.has(method)) return "dashboards.write";

  if (ENROLLMENT_READ.has(method)) return "enrollment.read";

  if (ENROLLMENT_WRITE.has(method)) return "enrollment.write";

  if (IDENTITY_READ.has(method)) return "identity.read";

  if (IDENTITY_WRITE.has(method)) return "identity.write";

  if (MANAGEMENT_READ.has(method)) return "management.read";

  if (MANAGEMENT_WRITE.has(method)) return "management.write";

  if (WEBHOOK_READ.has(method)) return "webhooks.read";

  if (WEBHOOK_WRITE.has(method)) return "webhooks.write";

  if (MEMBER_READ.has(method)) return "members.read";

  if (MEMBER_WRITE.has(method)) return "members.write";

  if (ROLE_READ.has(method)) return "roles.read";

  if (ROLE_WRITE.has(method)) return "roles.write";

  // Unknown methods fail safe to tenant write for mutations and tenant read for
  // obvious reads. This keeps future endpoints permission-checked by default.
  if (/^(list|get|search|export|preview|download)/.test(method)) return "tenant.read";

  if (method === "acceptInvitation" || method === "getEnrollment") return undefined;

  return "tenant.write";
};

export type ResolvedTenantRole = {
  readonly roleName: string;
  readonly roleKey: string;
  readonly roleKind: "built-in" | "custom";
  readonly roleId: string | null;
  readonly permissions: ReadonlySet<Permission>;
};

type MemberRole = {
  readonly role: string;
  readonly organizationId: string;
  readonly customRoleId?: string | null;
};

export const resolveTenantRole = (
  db: EnterpriseDb,
  member: MemberRole,
): Effect.Effect<ResolvedTenantRole, any, any> =>
  Effect.gen(function* () {
    if (member.customRoleId) {
      const role = yield* db.query.tenantRole.findFirst({
        where: { id: member.customRoleId, organizationId: member.organizationId },
      });

      if (role) {
        const permissions = Array.isArray(role.permissions) ? role.permissions : [];

        return {
          roleName: role.name,
          roleKey: role.id,
          roleKind: "custom" as const,
          roleId: role.id,
          permissions: new Set(
            permissions.filter((permission): permission is Permission =>
              PERMISSION_SET.has(permission),
            ),
          ),
        };
      }
    }

    return {
      roleName: member.role
        .split(",")
        .map((raw) => {
          const part = raw.trim();

          return isBuiltInTenantRole(part) ? BUILT_IN_ROLE_LABELS[part] : part;
        })
        .join(", "),
      roleKey: member.role,
      roleKind: "built-in" as const,
      roleId: null,
      permissions: builtInRolePermissions(member.role),
    };
  });

/** Normalise the JSON array stored on a role, dropping unknown permissions. */
export const normalizePermissions = (input: ReadonlyArray<string>): Permission[] =>
  [...new Set(input)].filter((permission): permission is Permission =>
    PERMISSION_SET.has(permission),
  );
