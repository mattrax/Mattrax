import { useParams } from "@solidjs/router";
import { useQuery } from "@tanstack/solid-query";
import {
  BUILT_IN_ROLE_LABELS,
  builtInRolePermissions,
  isBuiltInTenantRole,
} from "@mattrax/enterprise-domain/client";
import type { Permission, TenantDetail, TenantInfo } from "@mattrax/enterprise-domain/client";
import { createMemo, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import { authClient } from "~/lib/auth";
import { meQueryOptions, resolveActiveTenant } from "~/lib/enterprise";
import { cn } from "~/lib/utils";

/**
 * A membership with the optional RBAC fields. Fields are optional in the type
 * only so the dashboard compiles against an older API contract; at runtime the
 * permission set is used whenever the response includes it.
 */
export type TenantRbac = {
  role: string | undefined;
  permissions: ReadonlyArray<Permission> | undefined;
  roleName: string | undefined;
  roleKind: "built-in" | "custom" | undefined;
  roleId: string | undefined;
};

const asTenant = (
  tenant: TenantInfo | TenantDetail | undefined,
): (TenantInfo | TenantDetail) | undefined => tenant;

/** Read the optional RBAC fields from a membership. */
export function tenantRbac(tenant: TenantInfo | TenantDetail | undefined): TenantRbac {
  const value = asTenant(tenant);

  return {
    role: value?.role,
    permissions: value?.permissions,
    roleName: value?.roleName,
    roleKind: value?.roleKind,
    roleId: value?.roleId ?? undefined,
  };
}

/**
 * Resolve the permissions a tenant membership grants.
 *
 * Once the API sends an explicit permission set it is the source of truth: a
 * custom role may be any subset of the catalogue. Before that lands (or for a
 * built-in role), derive the set from the role string. Comma-separated legacy
 * roles are unioned by the domain helper.
 */
export function tenantPermissions(
  tenant: TenantInfo | TenantDetail | undefined,
): ReadonlySet<Permission> {
  if (!tenant) return new Set<Permission>();

  if (tenant.permissions) return new Set(tenant.permissions);

  return builtInRolePermissions(tenant.role ?? "");
}

export function tenantRoleName(tenant: TenantInfo | TenantDetail | undefined): string | undefined {
  if (!tenant) return undefined;

  if (tenant.roleName) return tenant.roleName;

  for (const role of (tenant.role ?? "").split(",")) {
    const name = role.trim();

    if (isBuiltInTenantRole(name)) return BUILT_IN_ROLE_LABELS[name];
  }

  return tenant.role || undefined;
}

export type TenantPermissionsApi = {
  /** The active membership, once `me` has loaded. */
  tenant: () => TenantInfo | undefined;
  /** True when the membership is known; permission checks fail closed before then. */
  known: () => boolean;
  permissions: () => ReadonlySet<Permission>;
  role: () => string | undefined;
  roleName: () => string | undefined;
  can: (permission: Permission) => boolean;
  canAny: (permissions: ReadonlyArray<Permission>) => boolean;
  canAll: (permissions: ReadonlyArray<Permission>) => boolean;
};

/**
 * Permissions for the tenant in the current URL. Every tenant page and the
 * dashboard shell read the same `me` query, so this adds no extra request.
 */
export function useTenantPermissions(): TenantPermissionsApi {
  const params = useParams();
  const session = authClient.useSession();
  const me = useQuery(() => meQueryOptions(session().data?.user?.id));
  const tenant = createMemo(() => resolveActiveTenant(me.data, params.tenantId));
  const permissions = createMemo(() => tenantPermissions(tenant()));

  return {
    tenant,
    known: () => tenant() !== undefined,
    permissions,
    role: () => tenantRbac(tenant()).role,
    roleName: () => tenantRoleName(tenant()),
    can: (permission) => permissions().has(permission),
    canAny: (required) => required.some((permission) => permissions().has(permission)),
    canAll: (required) => required.every((permission) => permissions().has(permission)),
  };
}

/** Shorthand for components that only need the predicate. */
export function useCan() {
  const { can, canAny, canAll } = useTenantPermissions();

  return { can, canAny, canAll };
}

/**
 * Render children only when the active membership grants `permission`.
 * Unknown permissions deny, so a control is never briefly enabled for a
 * read-only member while `me` is still loading.
 */
export function Can(props: {
  permission: Permission;
  fallback?: JSX.Element;
  children: JSX.Element;
}) {
  const { can } = useCan();

  return (
    <Show when={can(props.permission)} fallback={props.fallback}>
      {props.children}
    </Show>
  );
}

/** Shared banner for a read surface whose form controls are disabled. */
export function ReadOnlyNotice(props: { class?: string; children?: JSX.Element }) {
  return (
    <div
      role="status"
      class={cn(
        "flex items-start gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-[12px] leading-relaxed text-muted-foreground",
        props.class,
      )}
    >
      <span class="mt-1 size-1.5 shrink-0 rounded-full bg-muted-foreground/60" aria-hidden="true" />
      <span>
        {props.children ??
          "You have read-only access to this area. Changes are disabled for your role."}
      </span>
    </div>
  );
}

/** Clean denial panel for a guarded tenant route. */
export function AccessDenied(props: { title?: string; message?: string; action?: JSX.Element }) {
  return (
    <div class="flex flex-1 items-center justify-center px-4 py-16">
      <div class="w-full max-w-md rounded-xl border border-border bg-surface p-6 text-center">
        <h1 class="text-[15px] font-semibold text-foreground">
          {props.title ?? "You don't have access"}
        </h1>
        <p class="mt-1.5 text-[12.5px] leading-relaxed text-muted-foreground">
          {props.message ??
            "Your role does not include permission for this area. Ask a tenant owner if you need access."}
        </p>
        <Show when={props.action}>
          <div class="mt-4 flex justify-center">{props.action}</div>
        </Show>
      </div>
    </div>
  );
}

export {
  MIGRATION_ACCESS_PERMISSIONS,
  MIGRATION_MOVE_PERMISSIONS,
  firstReadableSettingsTab,
  firstReadableTenantSection,
  permissionForTenantPath,
  settingsTabPermission,
  settingsTabPermissions,
  tenantSectionPermission,
} from "~/lib/settings-permissions";

/** Any of these makes the Settings section worth showing in navigation. */
export const SETTINGS_READ_PERMISSIONS: ReadonlyArray<Permission> = [
  "tenant.read",
  "members.read",
  // OS updates and Migration are settings tabs gated by devices.read.
  "devices.read",
  "identity.read",
  "enrollment.read",
  // Scope tags are a settings surface even for a role that only reads them.
  "scope_tags.read",
  // OS updates and Migration are settings tabs gated by devices.read.
  "devices.read",
  "management.read",
  "webhooks.read",
  "audit.read",
  "billing.read",
  "approvals.read",
  "backups.read",
  // Export/import can move a tenant without device access.
  "tenant.export",
  "tenant.import",
];
