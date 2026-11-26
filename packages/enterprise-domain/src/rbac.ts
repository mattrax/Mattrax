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
  "devices.handover",
  "groups.read",
  "groups.write",
  "policies.read",
  "policies.write",
  "applications.read",
  "applications.write",
  "scripts.read",
  "scripts.write",
  "restricted_software.read",
  "restricted_software.write",
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
  "scope_tags.read",
  "scope_tags.write",
  "approvals.read",
  "approvals.write",
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
      {
        id: "devices.handover",
        label: "Hand over devices",
        description:
          "Export escrowed device secrets in a passphrase-sealed archive before deleting the device.",
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
    id: "scripts",
    label: "Scripts",
    description: "Scripts run on managed devices.",
    permissions: [
      { id: "scripts.read", label: "View scripts", description: "See scripts and run history." },
      {
        id: "scripts.write",
        label: "Manage and run scripts",
        description: "Create, edit, assign and run scripts.",
      },
    ],
  },
  {
    id: "restricted_software",
    label: "Restricted software",
    description: "Deny-listed applications, violations and enforcement.",
    permissions: [
      {
        id: "restricted_software.read",
        label: "View restricted software",
        description: "See deny-list rules and detected violations.",
      },
      {
        id: "restricted_software.write",
        label: "Manage restricted software",
        description: "Create, edit, scope and delete deny-list rules.",
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
    id: "scope_tags",
    label: "Scope tags",
    description: "Regional or team scopes for delegated administrators.",
    permissions: [
      {
        id: "scope_tags.read",
        label: "View scope tags",
        description: "See tags and which resources carry them.",
      },
      {
        id: "scope_tags.write",
        label: "Manage scope tags",
        description: "Create tags, rename them and tag resources.",
      },
    ],
  },
  {
    id: "approvals",
    label: "Approvals",
    description: "Second-person approval policies and the approval queue.",
    permissions: [
      {
        id: "approvals.read",
        label: "View approvals",
        description: "See approval requests, their payload summary and decisions.",
      },
      {
        id: "approvals.write",
        label: "Manage approvals",
        description: "Configure approval policies and approve or reject requests.",
      },
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
  // Webhook secrets, delivery history, backups and the approval queue are
  // operational admin surfaces. Backups contain full tenant data and stay with
  // owners; the queue exposes destructive requests and who is deciding them.
  member: READ_PERMISSIONS.filter(
    (permission) =>
      permission !== "webhooks.read" &&
      permission !== "approvals.read" &&
      !permission.startsWith("backups."),
  ),
  auditor: READ_PERMISSIONS.filter(
    (permission) =>
      permission !== "webhooks.read" &&
      permission !== "approvals.read" &&
      !permission.startsWith("backups."),
  ),
};

export const BUILT_IN_ROLE_LABELS: Record<BuiltInTenantRole, string> = {
  owner: "Owner",
  admin: "Administrator",
  member: "Member",
  auditor: "Auditor",
};

const BUILT_IN_TENANT_ROLE_SCHEMA = Schema.Literals(BUILT_IN_TENANT_ROLES);

export const isBuiltInTenantRole = (value: string): value is BuiltInTenantRole =>
  Schema.is(BUILT_IN_TENANT_ROLE_SCHEMA)(value);

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

/**
 * Broad scopes still stored on credentials created before fine-grained grants.
 * `write` and `mcp` mean "every permission the account's role allows"; `read`
 * means the read half of the catalogue.
 */
export const CREDENTIAL_BROAD_SCOPES = ["read", "write", "mcp"] as const;

export type CredentialBroadScope = (typeof CREDENTIAL_BROAD_SCOPES)[number];

export const CredentialScope = Schema.Union([Permission, Schema.Literals(CREDENTIAL_BROAD_SCOPES)]);

export type CredentialScope = typeof CredentialScope.Type;

/**
 * Canonical permission list for a credential grant.
 *
 * A permission that mutates a resource also implies its `.read` companion, so
 * a token granted `devices.write` can list the devices it changes. Unknown
 * entries fail the whole request rather than being ignored; a stale client
 * must not silently create a broader or narrower token than it asked for.
 */
export const normalizeCredentialPermissions = (
  values: ReadonlyArray<string>,
): ReadonlyArray<Permission> | undefined => {
  const selected = new Set<Permission>();

  for (const value of values) {
    if (!isPermission(value)) return undefined;
    selected.add(value);

    const dot = value.lastIndexOf(".");

    if (dot <= 0) continue;
    const companion = `${value.slice(0, dot)}.read`;

    if (companion !== value && isPermission(companion)) selected.add(companion);
  }

  return PERMISSIONS.filter((permission) => selected.has(permission));
};

/**
 * Effective permission ceiling of an API token or OAuth connection. The
 * account's role is applied separately in `requireTenant`, so the result here
 * is the credential's own limit, never a grant.
 */
export const credentialPermissions = (
  scopes: ReadonlyArray<string> | null | undefined,
): ReadonlySet<Permission> => {
  if (scopes == null) return new Set(PERMISSIONS);

  const selected = new Set<Permission>();

  for (const scope of scopes) {
    if (scope === "write" || scope === "mcp") return new Set(PERMISSIONS);

    if (scope === "read") {
      for (const permission of READ_PERMISSIONS) selected.add(permission);

      continue;
    }

    if (!isPermission(scope)) continue;
    selected.add(scope);

    const dot = scope.lastIndexOf(".");

    if (dot <= 0) continue;
    const companion = `${scope.slice(0, dot)}.read`;

    if (companion !== scope && isPermission(companion)) selected.add(companion);
  }

  return selected;
};

/** True when the credential was not narrowed to a permission list. */
export const hasUnrestrictedCredential = (
  scopes: ReadonlyArray<string> | null | undefined,
): boolean =>
  scopes == null ||
  scopes.includes("write") ||
  scopes.includes("mcp") ||
  credentialPermissions(scopes).size === PERMISSIONS.length;

/** The canonical read permission for a group, used by permission pickers. */
export const readPermissionFor = (permission: string): Permission | undefined => {
  const dot = permission.lastIndexOf(".");

  if (dot <= 0) return undefined;
  const companion = `${permission.slice(0, dot)}.read`;

  return companion !== permission && isPermission(companion) ? companion : undefined;
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
