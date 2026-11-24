import { useLocation } from "@solidjs/router";
import { useQuery } from "@tanstack/solid-query";
import { createEffect, createSignal, onSettled, Show } from "solid-js";
import { readLastTenant } from "~/components/app-shell";
import { authClient } from "~/lib/auth";
import { meQueryOptions } from "~/lib/enterprise";
import { useNavigate } from "~/lib/navigation";
import { tenantLandingHref } from "~/lib/tenant";

/**
 * `/t` is the tenant browser shortcut: it forwards to the account's default
 * tenant (or the same fallback `/dashboard` uses) and keeps any query string or
 * anchor on the way through. Tenant URLs themselves stay `/t/:tenantId`.
 */
export default function TenantLandingPage() {
  const session = authClient.useSession();
  const me = useQuery(() => meQueryOptions(session().data?.user?.id));
  const location = useLocation();
  const navigate = useNavigate();
  const [ready, setReady] = createSignal(false);

  // Wait for hydration before a redirect so the SSR shell is claimed first.
  onSettled(() => {
    setReady(true);
  });

  createEffect(
    () => ({
      ready: ready(),
      loading: me.isPending && !me.data,
      failed: me.isError && !me.data,
      tenants: me.data?.tenants,
      defaultTenantId: me.data?.account.defaultTenantId,
      tail: `${location.search}${location.hash}`,
    }),
    ({ ready, loading, failed, tenants, defaultTenantId, tail }) => {
      if (!ready || loading) return;

      // A failed membership read has the same answer as the dashboard: let
      // that page own the retry/error surface rather than spinning here.
      if (failed) {
        navigate("/dashboard", { replace: true });

        return;
      }

      const target = tenantLandingHref(
        tenants,
        { defaultTenantId, lastTenantId: readLastTenant() },
        tail,
      );

      navigate(target ?? "/tenants/new", { replace: true });
    },
  );

  return (
    <Show when={!ready() || (me.isPending && !me.data)} fallback={null}>
      <div class="flex flex-1 items-center justify-center py-24">
        <p role="status" class="text-[12px] text-muted-foreground">
          Opening your tenant…
        </p>
      </div>
    </Show>
  );
}
