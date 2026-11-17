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

/** The path segment a tenant should appear as. */
export const canonicalTenantParam = (tenant: TenantKey): string => tenant.slug || tenant.id;

export const tenantMatchesKey = (tenant: TenantKey, key: string): boolean =>
  tenant.id === key || tenant.slug === key;

/**
 * The canonical segment for a value that may be an id or a slug. Used by the
 * route builders so a click never starts on a legacy id URL once the shell
 * knows the tenant.
 */
export function canonicalTenantSegment(value: string): string {
  const tenant = directory.find((entry) => tenantMatchesKey(entry, value));

  return tenant ? canonicalTenantParam(tenant) : value;
}

/**
 * The membership a URL segment names, accepting both the canonical slug and
 * the legacy id. With no key the first membership is the sensible default for
 * unscoped pages (the tenant picker and `/dashboard`).
 */
export function resolveTenant<T extends TenantKey>(
  tenants: readonly T[] | undefined,
  key?: string,
): T | undefined {
  if (!tenants) return undefined;

  if (!key) return tenants[0];

  const direct = tenants.find((tenant) => tenantMatchesKey(tenant, key));

  if (direct) return direct;

  // A slug saved in this tab is usable before `/me` has re-fetched the new
  // membership list (the tenant id does not change).
  const pendingId = aliases.get(key);

  return pendingId ? tenants.find((tenant) => tenant.id === pendingId) : undefined;
}

export type TenantLandingPreference = {
  /** Account-level choice from `/me`; only honoured while it is a membership. */
  readonly defaultTenantId?: string | null;
  /** Browser-scoped last-used tenant. */
  readonly lastTenantId?: string | null;
};

/**
 * Where an unscoped page (`/dashboard`, the shell's tenant picker) should land.
 *
 * The account-level default wins over the browser's last-used tenant so a new
 * device or incognito session still starts where the account chose. Either
 * value is ignored once the membership disappears, and an account with no
 * preference falls back to the server's first membership, exactly as before.
 */
export function resolveLandingTenant<T extends TenantKey>(
  tenants: readonly T[] | undefined,
  preference: TenantLandingPreference = {},
): T | undefined {
  if (!tenants || tenants.length === 0) return undefined;

  const { defaultTenantId, lastTenantId } = preference;

  const preferred = defaultTenantId
    ? tenants.find((tenant) => tenantMatchesKey(tenant, defaultTenantId))
    : undefined;

  if (preferred) return preferred;

  const remembered = lastTenantId
    ? tenants.find((tenant) => tenantMatchesKey(tenant, lastTenantId))
    : undefined;

  return remembered ?? tenants[0];
}

/**
 * The memberships the current request/session can address. The API client only
 * speaks tenant ids, while the router carries slugs, so every `/api` call
 * routes its tenant parameter through {@link resolveTenantId}.
 *
 * The directory is seeded from the preloaded `/me` shell during SSR and from
 * the same shell (or the per-account cache) in the browser. An unknown value
 * is passed through unchanged so an id created moments ago still works before
 * the membership list refreshes.
 */
let directory: readonly TenantKey[] = [];

/** Slugs saved in this tab that the membership shell has not seen yet. */
const aliases = new Map<string, string>();

export function rememberTenantAlias(slug: string, id: string): void {
  if (slug) aliases.set(slug, id);
}

export function rememberTenants(tenants: readonly TenantKey[] | undefined): void {
  if (!tenants) return;

  // Snapshot plain values: callers hand us reactive query stores, and the
  // directory is read from untracked scopes (query keys, API helpers) where a
  // pending async property read would suspend or trip the strict-read
  // diagnostic.
  directory = tenants.map((tenant) => ({
    id: tenant.id,
    slug: tenant.slug ?? null,
    name: tenant.name,
  }));
}

export function resolveTenantId(value: string | undefined): string | undefined {
  if (!value) return undefined;

  // Ids win over slugs on the astronomically unlikely collision so an existing
  // API identifier is never silently redirected to another tenant.
  const exact = directory.find((tenant) => tenant.id === value);

  if (exact) return exact.id;

  return directory.find((tenant) => tenant.slug === value)?.id ?? aliases.get(value) ?? value;
}

/** Test hook: clears the process/isolate-level membership directory. */
export function resetTenantDirectory(): void {
  directory = [];
  aliases.clear();
}
