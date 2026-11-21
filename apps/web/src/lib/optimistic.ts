import type { InfiniteData, QueryClient } from "@tanstack/solid-query";
import { enterpriseKeys } from "~/lib/enterprise";
import type { DeviceRow, Entity, MeResponse, RowFor } from "~/lib/enterprise";

/** The shape every entity list endpoint returns. */
type RowsResponse<T> = { rows: T[] };

/** The shape the paged device search returns. */
type DeviceSearchResponse = { devices: DeviceRow[]; total: number };

/**
 * Apply an optimistic update to every cached query matching `queryKey` and
 * return a function that puts the previous data back.
 *
 * Caches are cancelled first so an in-flight refetch cannot land on top of the
 * optimistic value, and the snapshot restores each exact key so a failed
 * mutation leaves the cache genuinely unchanged. Callers use the returned
 * function from `onError`; `onSettled` still invalidates to reconcile.
 */
export const optimisticUpdate = async <T>(
  queryClient: QueryClient,
  queryKey: readonly unknown[],
  update: (current: T) => T,
): Promise<() => void> => {
  await queryClient.cancelQueries({ queryKey });
  const previous = queryClient.getQueriesData<T>({ queryKey });

  queryClient.setQueriesData<T>({ queryKey }, (current) =>
    current === undefined ? current : update(current),
  );

  return () => {
    for (const [key, data] of previous) queryClient.setQueryData(key, data);
  };
};

/** Rewrite the rows of every cached list of one entity type. */
export const optimisticallyUpdateList = <E extends Entity>(
  queryClient: QueryClient,
  tenantId: string,
  entity: E,
  update: (rows: RowFor<E>[]) => RowFor<E>[],
) =>
  optimisticUpdate<RowsResponse<RowFor<E>>>(
    queryClient,
    enterpriseKeys.listPrefix(tenantId, entity),
    (current) => ({
      ...current,
      rows: update(current.rows),
    }),
  );

/** The row shape every paginated entity page shares. */
type EntitySearchRow = { id: string };

/**
 * One cached page of an entity list. Only one collection field is present on
 * any given entity's page; naming all three keeps a single update helper
 * honest without a dictionary of unknown values.
 */
type EntitySearchPage = {
  total: number;
  groups?: EntitySearchRow[];
  policies?: EntitySearchRow[];
  applications?: EntitySearchRow[];
};

const dropEntitySearchRows = (page: EntitySearchPage, removed: ReadonlySet<string>) => {
  if (page.groups) {
    const kept = page.groups.filter((row) => !removed.has(row.id));

    return {
      ...page,
      groups: kept,
      total: Math.max(0, page.total - (page.groups.length - kept.length)),
    };
  }

  if (page.policies) {
    const kept = page.policies.filter((row) => !removed.has(row.id));

    return {
      ...page,
      policies: kept,
      total: Math.max(0, page.total - (page.policies.length - kept.length)),
    };
  }

  if (page.applications) {
    const kept = page.applications.filter((row) => !removed.has(row.id));

    return {
      ...page,
      applications: kept,
      total: Math.max(0, page.total - (page.applications.length - kept.length)),
    };
  }

  return page;
};

/**
 * Drop rows from every cached page of an entity's server-paginated list and
 * keep each page's `total` honest. The infinite query stores pages under the
 * entity-search prefix, which the plain list helper never matches.
 */
export const optimisticallyRemoveEntitySearchRows = <E extends Entity>(
  queryClient: QueryClient,
  tenantId: string,
  entity: E,
  ids: Iterable<string>,
) => {
  if (entity === "device") return Promise.resolve(() => {});

  const removed = new Set(ids);

  return optimisticUpdate<InfiniteData<EntitySearchPage, number>>(
    queryClient,
    enterpriseKeys.entitySearchPrefix(tenantId, entity),
    (current) => ({
      ...current,
      pages: current.pages.map((page) => dropEntitySearchRows(page, removed)),
    }),
  );
};

/** Drop rows from every cached list and paginated page of one entity type. */
export const optimisticallyRemoveRows = async <E extends Entity>(
  queryClient: QueryClient,
  tenantId: string,
  entity: E,
  ids: Iterable<string>,
) => {
  const removed = new Set(ids);

  const restoreList = await optimisticallyUpdateList(queryClient, tenantId, entity, (rows) =>
    rows.filter((row) => !removed.has(row.id)),
  );

  const restoreSearch = await optimisticallyRemoveEntitySearchRows(
    queryClient,
    tenantId,
    entity,
    removed,
  );

  return () => {
    restoreList();
    restoreSearch();
  };
};

/** Patch one cached entity row so a detail header updates before the refetch. */
export const optimisticallyPatchItem = <E extends Entity>(
  queryClient: QueryClient,
  tenantId: string,
  entity: E,
  id: string,
  patch: Partial<RowFor<E>>,
) =>
  optimisticUpdate<RowFor<E>>(
    queryClient,
    enterpriseKeys.item(tenantId, entity, id),
    (current) => ({
      ...current,
      ...patch,
    }),
  );

/** Rewrite any cached device search page, including its total. */
export const optimisticallyUpdateDeviceSearch = (
  queryClient: QueryClient,
  tenantId: string,
  update: (current: DeviceSearchResponse) => DeviceSearchResponse,
) =>
  optimisticUpdate<DeviceSearchResponse>(
    queryClient,
    enterpriseKeys.deviceSearchPrefix(tenantId),
    update,
  );

/** Drop devices from cached search pages and keep each page's total honest. */
export const optimisticallyRemoveDevices = (
  queryClient: QueryClient,
  tenantId: string,
  ids: Iterable<string>,
) => {
  const removed = new Set(ids);

  return optimisticallyUpdateDeviceSearch(queryClient, tenantId, (current) => {
    const devices = current.devices.filter((device) => !removed.has(device.id));

    return {
      devices,
      total: Math.max(0, current.total - (current.devices.length - devices.length)),
    };
  });
};

/** Combine rollbacks from several optimistic writes into one handler. */
export const combineRestores = (restores: ReadonlyArray<() => void>) => () => {
  for (const restore of restores) restore();
};

/** The minimum shape of a row in a cached settings collection. */
type CollectionRow = { id: string };

/**
 * Rewrite one cached collection response such as `{ accounts: [...] }`.
 * Settings payloads (accounts, invitations, webhooks, SCIM tokens) are not
 * entity lists, so the entity helpers above do not apply to them. The row type
 * is named at the call site because the response type is not inferable from a
 * key alone.
 */
export const optimisticallyUpdateCollection = <K extends string, T>(
  queryClient: QueryClient,
  queryKey: readonly unknown[],
  collection: K,
  update: (rows: T[]) => T[],
) =>
  optimisticUpdate<Record<K, T[]>>(queryClient, queryKey, (current) => {
    const next = { ...current, [collection]: update(current[collection]) };

    // SAFETY: spread preserves every other property of `current`; the computed
    // key is `K`, so the result still satisfies `Record<K, T[]>`.
    return next;
  });

/** Drop rows from a cached collection response such as `{ endpoints: [...] }`. */
export const optimisticallyRemoveCollectionItems = <K extends string>(
  queryClient: QueryClient,
  queryKey: readonly unknown[],
  collection: K,
  ids: Iterable<string>,
) => {
  const removed = new Set(ids);

  return optimisticallyUpdateCollection<K, CollectionRow>(
    queryClient,
    queryKey,
    collection,
    (rows) => rows.filter((row) => !removed.has(row.id)),
  );
};

/** Patch the signed-in account's `/me` payload before the server answers. */
export const optimisticallyPatchMe = (
  queryClient: QueryClient,
  patch: Partial<MeResponse["account"]>,
) =>
  optimisticUpdate<MeResponse>(queryClient, enterpriseKeys.me(), (current) => ({
    ...current,
    account: { ...current.account, ...patch },
  }));
