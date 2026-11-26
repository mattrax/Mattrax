import { Context, Layer } from "effect";
import { getRequestEvent, isServer } from "@solidjs/web";

/** The SSR/browser context this module reads; tests pass their own explicitly. */
export type TenantEnvironment = {
  readonly isServer: boolean;
  readonly getRequestEvent: () => { readonly request: Request } | undefined;
};

/** Immutable production environment: Solid's real SSR flags. */
const solidEnvironment: TenantEnvironment = Object.freeze({ isServer, getRequestEvent });

/**
 * A tenant as the shell knows it. The API addresses tenants by id, but the
 * dashboard addresses them by slug so links survive exports/imports and match
 * what an administrator typed in settings.
 */
export type TenantKey = {
  readonly id: string;
  readonly slug?: string | null;
  readonly name?: string;
};

/** An immutable membership snapshot plus account-scoped pending slug aliases. */
export type TenantRoutingDirectory = {
  readonly tenants: readonly TenantKey[];
  readonly resolveId: (value: string | undefined) => string | undefined;
  readonly canonicalSegment: (value: string) => string;
  readonly resolveAlias: (value: string) => string | undefined;
};

/** Effect-facing request directory service. */
export class TenantDirectoryService extends Context.Service<
  TenantDirectoryService,
  TenantRoutingDirectory
>()("mattraxe/web/TenantDirectory") {}

const snapshot = (tenants: readonly TenantKey[] | undefined): readonly TenantKey[] =>
  tenants?.map((tenant) => ({
    id: tenant.id,
    slug: tenant.slug ?? null,
    name: tenant.name,
  })) ?? [];

export const createTenantDirectory = (
  tenants: readonly TenantKey[] | undefined,
  aliases: ReadonlyMap<string, string> = new Map(),
): TenantRoutingDirectory => {
  const entries = Object.freeze(snapshot(tenants));
  const byId = new Map(entries.map((tenant) => [tenant.id, tenant]));
  const bySlug = new Map(
    entries.flatMap((tenant) => (tenant.slug ? [[tenant.slug, tenant] as const] : [])),
  );
  const resolveId = (value: string | undefined): string | undefined => {
    if (!value) return undefined;

    // Ids win over slugs on the astronomically unlikely collision so an
    // existing API identifier is never silently redirected.
    return byId.get(value)?.id ?? bySlug.get(value)?.id ?? aliases.get(value) ?? value;
  };

  return Object.freeze({
    tenants: entries,
    resolveId,
    resolveAlias: (value) => aliases.get(value),
    canonicalSegment: (value) => {
      const tenant = byId.get(value) ?? bySlug.get(value);

      return tenant ? canonicalTenantParam(tenant) : value;
    },
  });
};

const emptyDirectory = createTenantDirectory([]);

/** The path segment a tenant should appear as. */
export const canonicalTenantParam = (tenant: TenantKey): string => tenant.slug || tenant.id;

export const tenantMatchesKey = (tenant: TenantKey, key: string): boolean =>
  tenant.id === key || tenant.slug === key;

/** SSR directories belong to one Request, never to the isolate. */
const requestDirectories = new WeakMap<Request, TenantRoutingDirectory>();

export const setRequestTenantDirectory = (
  request: Request,
  tenants: readonly TenantKey[] | undefined,
): void => {
  requestDirectories.set(request, createTenantDirectory(tenants));
};

export const getRequestTenantDirectory = (request: Request): TenantRoutingDirectory =>
  requestDirectories.get(request) ?? emptyDirectory;

export const requestTenantDirectoryLayer = (
  request: Request,
): Layer.Layer<TenantDirectoryService> =>
  Layer.succeed(TenantDirectoryService, getRequestTenantDirectory(request));

/** Browser snapshots are replaced atomically and aliases die with the account. */
let browserIdentity: string | undefined;
let browserTenants: readonly TenantKey[] = [];
const browserAliases = new Map<string, string>();

export const clearBrowserTenantDirectory = (): void => {
  browserIdentity = undefined;
  browserTenants = [];
  browserAliases.clear();
};

export const rememberTenants = (
  tenants: readonly TenantKey[] | undefined,
  identity?: string,
  environment: TenantEnvironment = solidEnvironment,
): void => {
  if (environment.isServer) {
    const event = environment.getRequestEvent();

    if (event) setRequestTenantDirectory(event.request, tenants);

    return;
  }

  if (identity !== undefined && identity !== browserIdentity) browserAliases.clear();
  browserIdentity = identity ?? browserIdentity;
  browserTenants = snapshot(tenants);
};

export const rememberTenantAlias = (
  slug: string,
  id: string,
  identity?: string,
  environment: TenantEnvironment = solidEnvironment,
): void => {
  if (environment.isServer || !slug) return;
  if (identity !== undefined && identity !== browserIdentity) {
    browserAliases.clear();
    browserTenants = [];
    browserIdentity = identity;
  }
  if (browserIdentity === undefined) return;
  browserAliases.set(slug, id);
};

/** Resolve the immutable directory for the current SSR request or browser account. */
export const currentTenantDirectory = (
  environment: TenantEnvironment = solidEnvironment,
): TenantRoutingDirectory => {
  if (environment.isServer) {
    const event = environment.getRequestEvent();

    return event ? getRequestTenantDirectory(event.request) : emptyDirectory;
  }

  return createTenantDirectory(browserTenants, browserAliases);
};

/**
 * The canonical segment for a value that may be an id or a slug. Used by the
 * route builders so a click never starts on a legacy id URL once the shell
 * knows the tenant.
 */
export function canonicalTenantSegment(
  value: string,
  directory: TenantRoutingDirectory = currentTenantDirectory(),
): string {
  return directory.canonicalSegment(value);
}

/**
 * The membership a URL segment names, accepting both the canonical slug and
 * the legacy id. With no key the first membership is the sensible default for
 * unscoped pages (the tenant picker and /dashboard).
 */
export function resolveTenant<T extends TenantKey>(
  tenants: readonly T[] | undefined,
  key?: string,
  directory: TenantRoutingDirectory = currentTenantDirectory(),
): T | undefined {
  if (!tenants) return undefined;
  if (!key) return tenants[0];

  const direct = tenants.find((tenant) => tenantMatchesKey(tenant, key));

  if (direct) return direct;

  // A slug saved in this account is usable before /me has re-fetched the new
  // membership list (the tenant id does not change).
  const pendingId = directory.resolveAlias(key);

  return pendingId ? tenants.find((tenant) => tenant.id === pendingId) : undefined;
}

export type TenantLandingPreference = {
  /** Account-level choice from /me; only honoured while it is a membership. */
  readonly defaultTenantId?: string | null;
  /** Browser-scoped last-used tenant. */
  readonly lastTenantId?: string | null;
};

/**
 * Where an unscoped page (/dashboard, the shell's tenant picker) should land.
 * The account-level default wins over the browser's last-used tenant. Either
 * value is ignored once the membership disappears.
 */
export function resolveLandingTenant<T extends TenantKey>(
  tenants: readonly T[] | undefined,
  preference: TenantLandingPreference = {},
): T | undefined {
  if (!tenants || tenants.length === 0) return undefined;

  const { defaultTenantId, lastTenantId } = preference;
  const preferred = defaultTenantId
    ? tenants.find((tenant) => tenant.id === defaultTenantId)
    : undefined;

  if (preferred) return preferred;

  const remembered = lastTenantId
    ? (tenants.find((tenant) => tenant.id === lastTenantId) ??
      tenants.find((tenant) => tenant.slug === lastTenantId))
    : undefined;

  return remembered ?? tenants[0];
}

/** Canonical unscoped tenant redirect, preserving query and hash. */
export function tenantLandingHref(
  tenants: readonly TenantKey[] | undefined,
  preference: TenantLandingPreference = {},
  tail = "",
): string | undefined {
  const tenant = resolveLandingTenant(tenants, preference);

  if (!tenant) return undefined;

  return `/t/${encodeURIComponent(canonicalTenantParam(tenant))}${tail}`;
}

/** Translate a route segment to an API id, preserving unknown-id pass-through. */
export function resolveTenantId(
  value: string | undefined,
  directory: TenantRoutingDirectory | undefined = undefined,
  environment: TenantEnvironment = solidEnvironment,
): string | undefined {
  return (directory ?? currentTenantDirectory(environment)).resolveId(value);
}
