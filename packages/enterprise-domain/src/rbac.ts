import { Schema } from "effect";

/**
 * The tenant permission catalogue. Permissions are deliberately resource-based
 * rather than role-based so custom roles can be composed without changing
 * endpoint code.
 */
export const PERMISSIONS = [
  "tenant.read",
  "tenant.write",
  "tenant.delete",
  "tenant.export",
  "tenant.import",
  "devices.read",
  "devices.write",
  "devices.command",
  "devices.recovery_key",
  "groups.read",
  "groups.write",
  "policies.read",
  "policies.write",
  "applications.read",
  "applications.write",
  "dashboards.read",
  "dashboards.write",
  "enrollment.read",
  "enrollment.write",
  "identity.read",
  "identity.write",
  "management.read",
  "management.write",
  "webhooks.read",
  "webhooks.write",
  "audit.read",
  "billing.read",
  "billing.write",
  "backups.read",
  "backups.write",
  "members.read",
  "members.write",
  "roles.read",
  "roles.write",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const Permission = Schema.Literals(PERMISSIONS);
export const PERMISSION_SET: ReadonlySet<string> = new Set(PERMISSIONS);

export const PERMISSION_GROUPS: ReadonlyArray<{
  id: string;
  label: string;
  description: string;
  permissions: ReadonlyArray<{ id: Permission; label: string; description: string }>;
}> = [
  {
    id: "devices",
    label: "Devices",
    description: "Inventory, edit, command and recovery-key access.",
    permissions: [
      { id: "devices.read", label: "View devices", description: "See devices and inventory." },
      { id: "devices.write", label: "Manage devices", description: "Edit and delete devices." },
      {
        id: "devices.command",
        label: "Send device commands",
        description: "Refresh, lock, wipe and other remote actions.",
      },
      {
        id: "devices.recovery_key",
        label: "Reveal recovery keys",
        description: "Read escrowed FileVault recovery keys.",
      },
    ],
  },
  {
    id: "groups",
    label: "Groups",
    description: "Device groups and dynamic membership.",
    permissions: [
      { id: "groups.read", label: "View groups", description: "See group membership." },
      {
        id: "groups.write",
        label: "Manage groups",
        description: "Create, edit and delete groups.",
      },
    ],
  },
  {
    id: "policies",
    label: "Policies",
    description: "Configuration policies and deployments.",
    permissions: [
      { id: "policies.read", label: "View policies", description: "Inspect policy configuration." },
      {
        id: "policies.write",
        label: "Manage policies",
        description: "Create, edit, deploy, duplicate and roll back policies.",
      },
    ],
  },
  {
    id: "applications",
    label: "Applications",
    description: "Application catalogue and software inventory.",
    permissions: [
      {
        id: "applications.read",
        label: "View applications",
        description: "See the catalogue and inventory.",
      },
      {
        id: "applications.write",
        label: "Manage applications",
        description: "Upload and assign applications.",
      },
    ],
  },
  {
    id: "dashboards",
    label: "Dashboards",
    description: "Shared dashboards and widgets.",
    permissions: [
      { id: "dashboards.read", label: "View dashboards", description: "View shared dashboards." },
      {
        id: "dashboards.write",
        label: "Manage dashboards",
        description: "Create, edit and delete dashboards.",
      },
    ],
  },
  {
    id: "enrollment",
    label: "Enrollment",
    description: "Platform enrollment settings and links.",
    permissions: [
      {
        id: "enrollment.read",
        label: "View enrollment",
        description: "See enrollment configuration.",
      },
      {
        id: "enrollment.write",
        label: "Manage enrollment",
        description: "Change enrollment settings.",
      },
    ],
  },
  {
    id: "identity",
    label: "Identity and access",
    description: "SSO, SCIM, domains and directory sync.",
    permissions: [
      {
        id: "identity.read",
        label: "View identity settings",
        description: "See SSO, SCIM and domain configuration.",
      },
      {
        id: "identity.write",
        label: "Manage identity",
        description: "Change SSO, SCIM and directory settings.",
      },
    ],
  },
  {
    id: "management",
    label: "Platform management",
    description: "Apple, Windows and Android management integrations.",
    permissions: [
      {
        id: "management.read",
        label: "View platform settings",
        description: "See APNs, ABM, VPP, Autopilot and Android settings.",
      },
      {
        id: "management.write",
        label: "Manage platforms",
        description: "Configure and sync platform integrations.",
      },
    ],
  },
  {
    id: "webhooks",
    label: "Webhooks",
    description: "Outbound event delivery.",
    permissions: [
      { id: "webhooks.read", label: "View webhooks", description: "See endpoints and deliveries." },
      {
        id: "webhooks.write",
        label: "Manage webhooks",
        description: "Create, edit, test and delete endpoints.",
      },
    ],
  },
  {
    id: "audit",
    label: "Audit log",
    description: "The tenant audit trail.",
    permissions: [
      { id: "audit.read", label: "View audit log", description: "Read and export audit entries." },
    ],
  },
  {
    id: "billing",
    label: "Billing",
    description: "Subscription and invoices.",
    permissions: [
      { id: "billing.read", label: "View billing", description: "See plan and invoices." },
      { id: "billing.write", label: "Manage billing", description: "Open the billing portal." },
    ],
  },
  {
    id: "backups",
    label: "Backups",
    description: "Tenant exports and backups.",
    permissions: [
      { id: "backups.read", label: "View backups", description: "List and download backups." },
      { id: "backups.write", label: "Create backups", description: "Run a tenant backup." },
    ],
  },
  {
    id: "members",
    label: "Members",
    description: "Tenant members and invitations.",
    permissions: [
      { id: "members.read", label: "View members", description: "See tenant membership." },
      {
        id: "members.write",
        label: "Manage members",
        description: "Invite, remove and assign member roles.",
      },
    ],
  },
  {
    id: "roles",
    label: "Roles",
    description: "Custom RBAC roles.",
    permissions: [
      { id: "roles.read", label: "View roles", description: "See role definitions." },
      { id: "roles.write", label: "Manage roles", description: "Create, edit and delete roles." },
    ],
  },
  {
    id: "tenant",
    label: "Tenant",
    description: "Tenant-wide settings, export and lifecycle.",
    permissions: [
      { id: "tenant.read", label: "Access tenant", description: "Baseline tenant read access." },
      { id: "tenant.write", label: "Edit tenant", description: "Change tenant settings." },
      { id: "tenant.export", label: "Export tenant", description: "Export tenant data." },
      { id: "tenant.import", label: "Import tenant", description: "Import tenant data." },
      {
        id: "tenant.delete",
        label: "Delete tenant",
        description: "Permanently delete the tenant.",
      },
    ],
  },
];

export const BUILT_IN_TENANT_ROLES = ["owner", "admin", "member", "auditor"] as const;
export type BuiltInTenantRole = (typeof BUILT_IN_TENANT_ROLES)[number];

const READ_PERMISSIONS = PERMISSIONS.filter((permission) => permission.endsWith(".read"));

export const BUILT_IN_ROLE_PERMISSIONS: Record<BuiltInTenantRole, ReadonlyArray<Permission>> = {
  owner: PERMISSIONS,
  // Administrators run the tenant but cannot delete, export or back it up.
  // Owners can delegate those through a custom role.
  admin: PERMISSIONS.filter(
    (permission) =>
      permission !== "tenant.delete" &&
      permission !== "tenant.export" &&
      !permission.startsWith("backups."),
  ),
  // Webhook secrets and delivery history are operational admin surfaces.
  member: READ_PERMISSIONS.filter((permission) => permission !== "webhooks.read"),
  auditor: READ_PERMISSIONS.filter((permission) => permission !== "webhooks.read"),
};

export const BUILT_IN_ROLE_LABELS: Record<BuiltInTenantRole, string> = {
  owner: "Owner",
  admin: "Administrator",
  member: "Member",
  auditor: "Auditor",
};

export const isBuiltInTenantRole = (value: string): value is BuiltInTenantRole =>
  (BUILT_IN_TENANT_ROLES as readonly string[]).includes(value);

export const isPermission = (value: string): value is Permission => PERMISSION_SET.has(value);

/** Union permissions for legacy comma-separated built-in roles. */
export const builtInRolePermissions = (role: string): Set<Permission> => {
  const permissions = new Set<Permission>();
  for (const part of role.split(",")) {
    const name = part.trim();
    if (isBuiltInTenantRole(name))
      for (const permission of BUILT_IN_ROLE_PERMISSIONS[name]) permissions.add(permission);
  }
  return permissions;
};

export const hasPermission = (
  permissions: ReadonlySet<string> | ReadonlyArray<string>,
  required: string,
): boolean => {
  const set = permissions instanceof Set ? permissions : new Set(permissions);
  return set.has(required);
};

export const hasAnyWritePermission = (permissions: ReadonlySet<string>): boolean =>
  [...permissions].some(
    (permission) =>
      permission.endsWith(".write") ||
      permission.endsWith(".command") ||
      permission.endsWith(".delete") ||
      permission === "tenant.delete",
  );

export const permissionLabel = (permission: string): string => {
  for (const group of PERMISSION_GROUPS)
    for (const item of group.permissions) if (item.id === permission) return item.label;
  return permission;
};

export const TenantRole = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: Schema.optional(Schema.NullOr(Schema.String)),
  permissions: Schema.Array(Permission),
  memberCount: Schema.Number,
  /** Built-in roles are virtual and cannot be edited or deleted. */
  builtIn: Schema.Boolean,
  createdAt: Schema.String,
  updatedAt: Schema.String,
});
export type TenantRole = typeof TenantRole.Type;

export const TenantRolesResponse = Schema.Struct({ roles: Schema.Array(TenantRole) });
export type TenantRolesResponse = typeof TenantRolesResponse.Type;

export const CreateTenantRoleRequest = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.NullOr(Schema.String)),
  permissions: Schema.Array(Permission),
});
export type CreateTenantRoleRequest = typeof CreateTenantRoleRequest.Type;

export const PatchTenantRoleRequest = Schema.Struct({
  name: Schema.optional(Schema.String),
  description: Schema.optional(Schema.NullOr(Schema.String)),
  permissions: Schema.optional(Schema.Array(Permission)),
});
export type PatchTenantRoleRequest = typeof PatchTenantRoleRequest.Type;

export const RoleAssignment = Schema.Struct({
  /** Present for a custom role. Built-in assignments use `role`. */
  roleId: Schema.optional(Schema.NullOr(Schema.String)),
  role: Schema.optional(Schema.NullOr(Schema.String)),
});
export type RoleAssignment = typeof RoleAssignment.Type;
