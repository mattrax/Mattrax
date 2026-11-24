import type { RoutePreloadFuncArgs } from "@solidjs/router";
import type { Permission, TenantInfo } from "@mattrax/enterprise-domain/client";
import { enterpriseKeys, resolveActiveTenant } from "~/lib/enterprise";
import { tenantPermissions } from "~/lib/permissions";
import { preloadPage } from "~/lib/page-data";
import { queryClient } from "~/lib/query-client";

type PreloadLoader = {
  /** The loader only runs when the cached membership grants this permission. */
  permission: Permission;
  load: () => Promise<void>;
};

/**
 * Warm a settings page's queries only for roles that may read them.
 *
 * On hover the router already has `me` in cache; without it we skip the warm
 * instead of sending a request that the layout would disable or the API would
 * reject with 403.
 */
export function preloadSettingsPage(
  args: RoutePreloadFuncArgs,
  loaders: ReadonlyArray<PreloadLoader>,
): Promise<void> | undefined {
  if (args.intent === "initial") return;

  const me = queryClient.getQueryData<{ tenants: readonly TenantInfo[] }>(enterpriseKeys.me());
  const permissions = me ? tenantPermissions(resolveActiveTenant(me, args.params.tenantId)) : null;

  return preloadPage(
    loaders.flatMap((loader) => (permissions?.has(loader.permission) ? [loader.load] : [])),
  );
}
