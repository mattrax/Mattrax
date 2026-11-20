import { and, eq } from "drizzle-orm";
import { Context, Effect } from "effect";
import { type EnterpriseDb, schema } from "@mattrax/enterprise-core";
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
  "getDeviceUsers",
  "listDevicePreRegistrations",
  "listAttributes",
  "listEnrollmentQuestions",
  "getPolicyVariables",
]);

const DEVICE_WRITE = new Set([
  "patchDevice",
  "deleteDevices",
  "deleteDevicePreRegistration",
  "deleteDevicePreRegistrations",
  "importDevicePreRegistrations",
  "deviceUnenroll",
  "revokeDeviceIdentity",
  "setDeviceUsers",
  "createAttribute",
  "patchAttribute",
  "deleteAttribute",
  "setDeviceAttributes",
  "importDeviceAttributes",
]);

const GROUP_READ = new Set(["listGroups", "getGroup", "getGroupScope", "previewGroup"]);

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
  "getPolicyScope",
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

const SCRIPT_READ = new Set([
  "listScripts",
  "getScript",
  "getScriptSettings",
  "getScriptAssignments",
  "listScriptExecutions",
]);

const SCRIPT_WRITE = new Set([
  "createScript",
  "patchScript",
  "deleteScript",
  "patchScriptSettings",
  "patchScriptAssignments",
  "runScript",
]);

const DASHBOARD_READ = new Set([
  "listDashboards",
  "getDashboard",
  "queryDashboard",
  "queryDashboardBatch",
]);

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
  "getTenantScepCa",
  "listEnrollmentAttempts",
  "getAppleEnrollmentProfile",
  "getAdeEnrollmentProfile",
]);

const ENROLLMENT_WRITE = new Set([
  "patchTenantEnrollment",
  "resetTenantEnrollment",
  "rotateTenantScepCa",
  "importTenantScepCa",
  "patchEnrollmentQuestions",
]);

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
  "linkDirectoryUserSso",
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
]);

const MANAGEMENT_WRITE = new Set([
  // Generating a CSR creates/replaces a pending APNs key pair.
  "getApnsCsr",
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

const WEBHOOK_READ = new Set([
  "listWebhookEndpoints",
  "listWebhookDeliveries",
  "getWebhookDelivery",
]);

const WEBHOOK_WRITE = new Set([
  "createWebhookEndpoint",
  "patchWebhookEndpoint",
  "deleteWebhookEndpoint",
  "rotateWebhookSecret",
  "testWebhookEndpoint",
  "replayWebhookDelivery",
]);

const MEMBER_READ = new Set([
  "listTenantAccounts",
  "listTenantInvitations",
  "getTenantInvitationOptions",
  "getTenantOwnershipTransfer",
]);

const MEMBER_WRITE = new Set([
  "inviteTenantAccount",
  "cancelTenantInvitation",
  "resendTenantInvitation",
  "patchTenantAccount",
  "patchTenantAccountRoles",
  "addUserGroupMembers",
  "removeTenantAccount",
  "requestTenantOwnershipTransfer",
]);

const ROLE_READ = new Set(["listTenantRoles"]);

const ROLE_WRITE = new Set(["createTenantRole", "patchTenantRole", "deleteTenantRole"]);

const EXPLICIT = {
  getTenant: "tenant.read",
  // Directory lists expose member names and email addresses, so they need the
  // same permission as the member list rather than plain tenant read.
  listDirectory: "members.read",
  listUsers: "members.read",
  // The detail view is the same directory data plus (permission-filtered)
  // device and policy sections, so the directory permission gates the read.
  getUser: "members.read",
  search: "tenant.read",
  patchTenant: "tenant.write",
  deleteTenant: "tenant.delete",
  exportTenant: "tenant.export",
  importTenant: "tenant.import",
  runTenantBackup: "backups.write",
  listTenantBackups: "backups.read",
  downloadTenantBackup: "backups.read",
  pinTenantBackup: "backups.write",
  unpinTenantBackup: "backups.write",
  deleteTenantBackup: "backups.write",
  restoreTenantBackup: "backups.write",
  listAuditLog: "audit.read",
  searchAuditLog: "audit.read",
  exportAuditLog: "audit.read",
  recordMcpActivity: "audit.read",
  billing: "billing.read",
  billingPortal: "billing.write",
  billingCheckout: "billing.write",
  billingInvoices: "billing.read",
  deviceAction: "devices.command",
  getDeviceRecoveryKey: "devices.recovery_key",
  // Managed-admin passwords and Activation Lock bypass codes are device
  // secrets: reading them is as sensitive as the recovery key.
  getDeviceLocalAdmin: "devices.recovery_key",
  getDeviceActivationLockBypassCode: "devices.recovery_key",
} satisfies Record<string, Permission>;

const EXPLICIT_PERMISSIONS = new Map(Object.entries(EXPLICIT));

/**
 * Account-scoped endpoints. These authenticate the caller but never resolve a
 * tenant membership, so no tenant permission applies and a custom role cannot
 * gain access to them by name. `bootstrap` is the SSR shell read: it returns
 * only the caller's own account and memberships.
 */
const ACCOUNT_METHODS = new Set([
  "bootstrap",
  // The MCP gateway's identity + allowed-method lookup. It is authenticated by
  // the same bearer credential as the MCP call; tenant authorisation still
  // happens on every method that resolves a tenant.
  "mcpContext",
  // Policy-editor helpers. They parse a caller-supplied profile for display
  // and never resolve a tenant, so they are authenticated account endpoints
  // rather than tenant-permission-gated ones.
  "extractMobileconfig",
  "previewMobileconfig",
]);

export const isAccountMethod = (method: string): boolean => ACCOUNT_METHODS.has(method);

export const permissionForMethod = (method: string): Permission | undefined => {
  if (ACCOUNT_METHODS.has(method)) return undefined;

  const explicit = EXPLICIT_PERMISSIONS.get(method);

  if (explicit) return explicit;

  if (DEVICE_READ.has(method)) return "devices.read";

  if (DEVICE_WRITE.has(method)) return "devices.write";

  if (GROUP_READ.has(method)) return "groups.read";

  if (GROUP_WRITE.has(method)) return "groups.write";

  if (POLICY_READ.has(method)) return "policies.read";

  if (POLICY_WRITE.has(method)) return "policies.write";

  if (APPLICATION_READ.has(method)) return "applications.read";

  if (APPLICATION_WRITE.has(method)) return "applications.write";

  if (SCRIPT_READ.has(method)) return "scripts.read";

  if (SCRIPT_WRITE.has(method)) return "scripts.write";

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

  // Public invitations: accepting and previewing are token-bound and gated by
  // the caller layer's rate limit instead of a tenant membership.
  if (
    method === "acceptInvitation" ||
    method === "previewInvitation" ||
    method === "acceptTenantOwnershipTransfer" ||
    method === "previewTenantOwnershipTransfer" ||
    // A target may decline without member-management rights; the handler
    // still enforces requester/target/owner before touching the row.
    method === "cancelTenantOwnershipTransfer" ||
    method === "getEnrollment" ||
    method === "submitEnrollmentAnswers"
  )
    return undefined;

  // Unknown methods fail safe to tenant write for mutations and tenant read for
  // obvious reads. This keeps future endpoints permission-checked by default.
  if (/^(list|get|search|export|preview|download)/.test(method)) return "tenant.read";

  return "tenant.write";
};

const rolesOf = (role: string) =>
  role
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

/** Legacy memberships may carry several comma-separated built-in roles. */
export const hasOwnerRole = (role: string) => rolesOf(role).includes("owner");

type OwnerCandidate = {
  readonly role: string;
  readonly customRoleId?: string | null;
};

/**
 * Owner authority comes only from the built-in owner role. A member assigned a
 * custom role is a delegation, so it must never count as an owner even when the
 * legacy `member.role` column still contains `owner`.
 */
export const isBuiltInOwnerMember = (member: OwnerCandidate) =>
  member.customRoleId == null && hasOwnerRole(member.role);

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
): Effect.Effect<ResolvedTenantRole, unknown, never> =>
  Effect.gen(function* () {
    if (member.customRoleId) {
      const role = yield* db.query.tenantRole.findFirst({
        where: { id: member.customRoleId, organizationId: member.organizationId },
      });

      if (role) return resolveTenantRoleFrom(member, role);
    }

    return resolveTenantRoleFrom(member);
  });

type CustomRoleRow = {
  readonly id: string;
  readonly name: string;
  readonly permissions: unknown;
};

/**
 * Resolve a membership's effective role from rows the caller already loaded.
 *
 * Tenant resolution reads the member, organisation and (for custom roles) the
 * role row anyway, so accepting them here avoids a second query per request
 * while keeping the permission derivation in one place.
 */
export const resolveTenantRoleFrom = (
  member: MemberRole,
  customRole?: CustomRoleRow | null,
): ResolvedTenantRole => {
  if (member.customRoleId && customRole) {
    const permissions = Array.isArray(customRole.permissions) ? customRole.permissions : [];

    return {
      roleName: customRole.name,
      roleKey: customRole.id,
      roleKind: "custom" as const,
      roleId: customRole.id,
      permissions: new Set(
        permissions.filter((permission): permission is Permission =>
          PERMISSION_SET.has(permission),
        ),
      ),
    };
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
};

export type TenantAccess = {
  readonly member: typeof schema.member.$inferSelect;
  readonly organization: typeof schema.organization.$inferSelect;
  readonly role: ResolvedTenantRole;
};

/**
 * Load a caller's membership, organisation and effective role in one query.
 *
 * Every tenant-scoped endpoint needs all three before it can authorise the
 * request. Reading them separately cost three sequential round trips on the
 * request path, which dominates a dashboard load at production database
 * latency. A custom role's row is joined rather than fetched afterwards, so the
 * query count stays at one for both built-in and custom roles.
 */
export const loadTenantAccess = (
  db: EnterpriseDb,
  accountId: string,
  organizationId: string,
): Effect.Effect<TenantAccess | undefined, unknown, never> =>
  Effect.gen(function* () {
    const [row] = yield* db
      .select({
        member: schema.member,
        organization: schema.organization,
        customRole: {
          id: schema.tenantRole.id,
          name: schema.tenantRole.name,
          permissions: schema.tenantRole.permissions,
        },
      })
      .from(schema.member)
      .innerJoin(schema.organization, eq(schema.organization.id, schema.member.organizationId))
      .leftJoin(
        schema.tenantRole,
        and(
          eq(schema.tenantRole.id, schema.member.customRoleId),
          eq(schema.tenantRole.organizationId, schema.member.organizationId),
        ),
      )
      .where(
        and(
          eq(schema.member.accountId, accountId),
          eq(schema.member.organizationId, organizationId),
        ),
      )
      .limit(1);

    if (!row) return undefined;

    return {
      member: row.member,
      organization: row.organization,
      role: resolveTenantRoleFrom(row.member, row.customRole?.id ? row.customRole : undefined),
    };
  });

/** Normalise the JSON array stored on a role, dropping unknown permissions. */
export const normalizePermissions = (input: ReadonlyArray<string>): Permission[] =>
  [...new Set(input)].filter((permission): permission is Permission =>
    PERMISSION_SET.has(permission),
  );
