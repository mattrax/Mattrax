import type { MeResponse } from "@mattrax/enterprise-domain/client";
import { queryOptions } from "@tanstack/solid-query";
import { getRequestEvent, isServer } from "@solidjs/web";
import { readMeCache, writeMeCache } from "~/lib/me-cache";
import type { MeCacheEntry } from "~/lib/me-cache";
import { ME_QUERY_KEY } from "~/lib/me-keys";
import { persistBrowserPreloadedMe, readBrowserPreloadedMe } from "~/lib/me-preload";
import { meQueryCachePolicy } from "~/lib/me-query";
import { getPreloadedSession } from "~/lib/session-store";
import { rememberTenants } from "~/lib/tenant";

const readPreloadedMe = (): MeResponse | undefined => {
  if (isServer) {
    const event = getRequestEvent();

    return event ? getPreloadedSession(event.request)?.me : undefined;
  }

  return readBrowserPreloadedMe();
};

/**
 * How the first observer seeds the query. An SSR preload paints immediately but
 * is stale once: its permission claims can be up to the five-minute SSR token
 * lifetime old. A localStorage entry keeps its own age so a warm tab still
 * avoids a request.
 */
export type MeQuerySeed = {
  readonly data: MeResponse;
  readonly initialDataUpdatedAt: number;
};

export const meQuerySeed = (
  preloaded: MeResponse | undefined,
  cached: MeCacheEntry | undefined,
): MeQuerySeed | undefined => {
  if (preloaded) return { data: preloaded, initialDataUpdatedAt: 0 };
  if (cached) return { data: cached.data, initialDataUpdatedAt: cached.updatedAt };

  return undefined;
};

export type MeQueryOptionsInput = {
  readonly userId?: string;
  readonly enabled: boolean;
  readonly fetchMe: () => Promise<MeResponse>;
};

/**
 * The shared `/me` query options. The enterprise module supplies the endpoint
 * and this module owns the cache/preload policy, so tests and the verification
 * helper do not have to import the full API client.
 */
export const buildMeQueryOptions = (input: MeQueryOptionsInput) => {
  const cached = readMeCache(input.userId);
  const preloaded = readPreloadedMe();
  const initialData =
    preloaded && (!input.userId || preloaded.account.id === input.userId) ? preloaded : undefined;

  // The router addresses tenants by slug while every API call needs the id;
  // keep the membership list available to that translation after SSR.
  rememberTenants(
    initialData?.tenants ?? cached?.data.tenants,
    initialData?.account.id ?? cached?.data.account.id ?? input.userId,
  );

  if (!isServer && initialData) persistBrowserPreloadedMe(initialData);

  const options = {
    queryKey: ME_QUERY_KEY,
    queryFn: async () => {
      const data = await input.fetchMe();
      rememberTenants(data.tenants, data.account.id);
      writeMeCache(data);

      return data;
    },
    enabled: !isServer && input.enabled,
    ...meQueryCachePolicy(),
  };

  if (isServer) {
    // TanStack renders this observer snapshot immediately without writing it
    // into the shared cache. That is essential on the server: the module-level
    // query client outlives a request, so `initialData` there could show one
    // account's shell to the next visitor.
    Object.assign(options, { placeholderData: initialData ?? cached?.data });
  } else {
    const seed = meQuerySeed(initialData, cached);

    if (seed !== undefined)
      Object.assign(options, {
        initialData: seed.data,
        initialDataUpdatedAt: seed.initialDataUpdatedAt,
      });
  }

  return queryOptions(options);
};
