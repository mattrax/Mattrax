import { useLocation, useNavigate, useParams } from "@solidjs/router";
import { useQuery } from "@tanstack/solid-query";
import { isServer } from "@solidjs/web";
import { createEffect, createSignal, type ParentProps, onHydrationEnd, Show } from "solid-js";
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
  const session = authClient.useSession();
  const me = useQuery(() => meQueryOptions(session().data?.user?.id));
  const { can } = useCan();

  const [hydrated, setHydrated] = createSignal(false);

  if (!isServer)
    onHydrationEnd(() => {
      setHydrated(true);
    });

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
        hydrated: hydrated(),
        denied: tag === "EnterpriseForbidden" || tag === "EnterpriseNotFound",
        failed: me.isError,
        pending: me.isPlaceholderData || me.isFetching,
        settled: me.isFetchedAfterMount,
      };
    },
    (state) => {
      // `navigate` needs a browser history; SSR has no membership check to do
      // beyond the queries, which stay disabled until hydration.
      if (isServer) return;

      if (state.denied) {
        navigate("/dashboard", { replace: true });

        return;
      }

      // A cached/preloaded shell is enough to know the tenant's canonical
      // segment; a background `/me` refresh failing must not strand an id URL.
      if (state.found) {
        // Only an id URL is rewritten. A slug is already canonical (and a
        // just-saved slug may not be in the refreshed membership shell yet).
        if (state.hydrated && state.canonical && state.tenantId === state.tenantRowId) {
          const prefix = `/t/${state.tenantId}`;
          const rest = state.path.startsWith(prefix) ? state.path.slice(prefix.length) : "";

          navigate(`/t/${state.canonical}${rest}${state.search}`, { replace: true });
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
        {props.children}
      </Show>
    </Show>
  );
}
