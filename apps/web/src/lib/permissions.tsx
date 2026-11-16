import { useParams } from "@solidjs/router";
import { routes } from "~/lib/routes";
import { useQuery } from "@tanstack/solid-query";
import {
  BUILT_IN_ROLE_LABELS,
  builtInRolePermissions,
  isBuiltInTenantRole,
  type Permission,
  type TenantDetail,
  type TenantInfo,
} from "@mattrax/enterprise-domain/client";
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

/** Read permission for each primary tenant section. */
export function tenantSectionPermission(section: string): Permission | undefined {
  switch (section) {
    case "overview":
      return "tenant.read";
    case "dashboards":
      return "dashboards.read";
    case "devices":
      return "devices.read";
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

/** Read permission for a settings tab. */
export function settingsTabPermission(tab: string): Permission {
  switch (tab) {
    case "administrators":
      return "members.read";
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
    case "billing":
      return "billing.read";
    default:
      return "tenant.read";
  }
}

/** Any of these makes the Settings section worth showing in navigation. */
export const SETTINGS_READ_PERMISSIONS: ReadonlyArray<Permission> = [
  "tenant.read",
  "members.read",
  "identity.read",
  "enrollment.read",
  "management.read",
  "webhooks.read",
  "audit.read",
  "billing.read",
];

const SETTINGS_TABS = [
  "",
  "administrators",
  "identity",
  "enrollment",
  "attributes",
  "management",
  "delivery",
  "integrations",
  "audit",
  "billing",
] as const;

const SECTIONS = [
  "overview",
  "dashboards",
  "devices",
  "groups",
  "policies",
  "applications",
  "scripts",
  "settings",
] as const;

/**
 * Resolve the permission required by a tenant path. Unknown paths return
 * `undefined` so they fall through instead of becoming accidentally locked.
 */
export function permissionForTenantPath(path: string, tenantId: string): Permission | undefined {
  const base = `/t/${tenantId}`;

  if (path === base || path === `${base}/`) return "tenant.read";

  const rest = path.slice(base.length).replace(/^\//, "");

  if (!rest) return "tenant.read";

  const [section, sub] = rest.split("/");

  if (section === "settings") {
    if (sub === undefined) return "tenant.read";

    return settingsTabPermission(sub);
  }

  if (section === "software") return "applications.read";

  if (section === "dashboards" && sub) return "dashboards.read";

  return section ? tenantSectionPermission(section) : undefined;
}

/** The canonical path of one top-level dashboard section. */
function sectionPath(tenantId: string, section: (typeof SECTIONS)[number]): string {
  const tenant = routes.tenant(tenantId);

  switch (section) {
    case "overview":
      return tenant.overview();
    case "dashboards":
      return tenant.dashboards();
    case "devices":
      return tenant.devices();
    case "groups":
      return tenant.groups();
    case "policies":
      return tenant.policies();
    case "applications":
      return tenant.applications();
    case "scripts":
      return tenant.scripts();
    case "settings":
      return tenant.settings();
  }
}

/** The first tenant section the current membership can read, if any. */
export function firstReadableTenantSection(
  can: (permission: Permission) => boolean,
  tenantId: string,
): string | undefined {
  for (const section of SECTIONS) {
    const permission = tenantSectionPermission(section);

    if (!permission || !can(permission)) continue;

    return sectionPath(tenantId, section);
  }

  for (const tab of SETTINGS_TABS) {
    if (!can(settingsTabPermission(tab))) continue;

    return routes.tenant(tenantId).settingsTab(tab);
  }

  return undefined;
}
