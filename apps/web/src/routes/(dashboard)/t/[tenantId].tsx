import { useIsRouting, useLocation, useParams } from "@solidjs/router";
import { useNavigate } from "~/lib/navigation";
import { useQuery, useQueryClient } from "@tanstack/solid-query";
import { isServer } from "@solidjs/web";
import { createEffect, Loading, Show } from "solid-js";
import type { ParentProps } from "solid-js";
import { authClient } from "~/lib/auth";
import { meQueryOptions, resolveActiveTenant } from "~/lib/enterprise";
import { canonicalTenantParam } from "~/lib/tenant";
import { errorTag, raisedFailure } from "~/lib/errors";
import {
  AccessDenied,
  firstReadableTenantSection,
  permissionForTenantPath,
  useCan,
} from "~/lib/permissions";
import { startTenantRealtime } from "~/lib/realtime";
import { LoadingState } from "@mattrax/ui";

/**
 * Guards every tenant-scoped route. The tenant id in the URL is the source of
 * truth, so a stale link or a tenant the user was removed from must not render
 * an empty shell full of failed requests. Wait for `me` and send the browser
 * back to `/dashboard` (which picks a membership it can actually show).
 */
export default function TenantLayout(props: ParentProps) {
  const params = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const isRouting = useIsRouting();
  const session = authClient.useSession();
  const me = useQuery(() => meQueryOptions(session().data?.user?.id));
  const { can } = useCan();

  // A tenant can appear in `me` after this component mounted (another tab
  // created one, or an invitation was just accepted), so a missing id gets one
  // fresh read before it is treated as unknown.
  let rechecked: string | undefined;

  const tenant = () => resolveActiveTenant(me.data, params.tenantId);

  /**
   * Slugs are the shareable, human-readable form of a tenant URL. An id still
   * opens the same tenant (bookmarks and integrations keep working) but the
   * address bar is rewritten to the canonical slug.
   */
  const canonicalParam = () => {
    const current = tenant();

    return current ? canonicalTenantParam(current) : undefined;
  };

  // Only guard paths we know. Unknown routes fall through so new pages are not
  // accidentally locked out while the map catches up.
  const requiredPermission = () =>
    permissionForTenantPath(location.pathname, params.tenantId ?? "");

  const denied = () => {
    const required = requiredPermission();

    return required !== undefined && !can(required);
  };

  const firstReadable = () => firstReadableTenantSection(can, params.tenantId ?? "");

  createEffect(
    () => {
      const tag = errorTag(raisedFailure(me.error));

      return {
        tenantId: params.tenantId,
        loaded: me.data !== undefined,
        found: tenant() !== undefined,
        tenantRowId: tenant()?.id,
        canonical: canonicalParam(),
        path: location.pathname,
        search: location.search,
        denied: tag === "EnterpriseForbidden" || tag === "EnterpriseNotFound",
        failed: me.isError,
        pending: me.isPlaceholderData || me.isFetching,
        settled: me.isFetchedAfterMount,
        routing: isRouting(),
      };
    },
    (state) => {
      // `navigate` needs a browser history; SSR has no membership check to do
      // beyond the queries, which stay disabled until hydration.
      if (isServer) return;

      // Issuing a second navigation while the transition that produced this
      // page is still settling can deadlock the router: both writes are
      // transitions and the URL settles on neither. Wait for it to land.
      if (state.routing) return;

      if (state.denied) {
        navigate("/dashboard", { replace: true });

        return;
      }

      // A cached/preloaded shell is enough to know the tenant's canonical
      // segment; a background `/me` refresh failing must not strand an id URL.
      if (state.found) {
        // Only an id URL is rewritten. A slug is already canonical (and a
        // just-saved slug may not be in the refreshed membership shell yet).
        if (state.canonical && state.tenantId === state.tenantRowId) {
          const prefix = `/t/${state.tenantId}`;
          const rest = state.path.startsWith(prefix) ? state.path.slice(prefix.length) : "";
          const target = `/t/${state.canonical}${rest}${state.search}`;

          // Rewriting inside the effect's own tick races the navigation that
          // produced the path change (both writes are transitions; the URL can
          // settle on neither). Defer one macrotask so the destination route
          // commits first, then replace only the tenant segment.
          setTimeout(() => {
            if (window.location.pathname.startsWith(prefix)) navigate(target, { replace: true });
          }, 0);
        }

        return;
      }

      if (state.failed || !state.loaded) return;

      // An in-flight fetch (including the first request that replaces cached
      // placeholder data) may still add the tenant; wait for it to settle.
      if (state.pending) return;

      if (!state.settled && rechecked !== state.tenantId) {
        rechecked = state.tenantId;
        void me.refetch();

        return;
      }

      navigate("/dashboard", { replace: true });
    },
    // Client-only: the SSR pass returns above, and the canonical rewrite must
    // run on the hydrated tree rather than adopting the server's empty value.
    { transparent: true },
  );

  return (
    <Show
      when={tenant()}
      fallback={
        <div class="flex flex-1 items-center justify-center py-24">
          <p role="status" class="text-[12px] text-muted-foreground">
            Opening tenant…
          </p>
        </div>
      }
    >
      <Show
        when={!denied()}
        fallback={
          <AccessDenied
            action={
              <Show when={firstReadable()}>
                {(href) => (
                  <a
                    class="rounded-lg bg-primary px-3 py-1.5 text-[12.5px] font-medium text-primary-foreground"
                    href={href()}
                  >
                    Open a section you can access
                  </a>
                )}
              </Show>
            }
          />
        }
      >
        {/* Keep this guard (and the shell around it) mounted while a nested
            route's chunk loads. Without its own boundary, the router's root
            loading state replaces the entire dashboard on every settings tab
            change. */}
        <Loading
          fallback={
            <div class="flex flex-1 items-center justify-center py-24">
              <LoadingState label="Loading section…" size={18} />
            </div>
          }
        >
          {props.children}
        </Loading>
        <RealtimeTenantSync tenantId={tenant()?.id ?? ""} />
      </Show>
    </Show>
  );
}

/**
 * One realtime subscription for the active tenant.
 *
 * Mounted inside the tenant guard so it starts only after membership resolved,
 * and stopped by the component's cleanup on sign-out, tenant switch or a
 * redirect. It never gates rendering: when the stream is unavailable the
 * subscriber falls back to polling in the background.
 */
function RealtimeTenantSync(props: { readonly tenantId: string }) {
  const queryClient = useQueryClient();

  createEffect(
    () => props.tenantId,
    (tenantId) => {
      if (!tenantId || isServer) return;

      const realtime = startTenantRealtime({ tenantId, queryClient });

      // Runs before the next tenant (or on disposal): closes the stream, its
      // timers and any pending invalidation.
      return () => realtime.dispose();
    },
  );

  return null;
}
