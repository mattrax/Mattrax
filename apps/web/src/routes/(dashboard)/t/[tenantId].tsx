import { useLocation, useNavigate, useParams } from "@solidjs/router";
import { useQuery } from "@tanstack/solid-query";
import { isServer } from "@solidjs/web";
import { createEffect, type ParentProps, Show } from "solid-js";
import { authClient } from "~/lib/auth";
import { meQueryOptions, resolveActiveTenant } from "~/lib/enterprise";
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

  // A tenant can appear in `me` after this component mounted (another tab
  // created one, or an invitation was just accepted), so a missing id gets one
  // fresh read before it is treated as unknown.
  let rechecked: string | undefined;

  const tenant = () => resolveActiveTenant(me.data, params.tenantId);

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

      if (state.failed || !state.loaded || state.found) return;

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
