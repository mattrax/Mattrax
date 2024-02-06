import { useNavigate, useParams } from "@solidjs/router";
import { useLocation } from "@solidjs/router";
import {
  ErrorBoundary,
  ParentProps,
  Show,
  Suspense,
  createEffect,
  createMemo,
} from "solid-js";
import LeftSidebar from "~/components/LeftSidebar";
import {
  SuspenseError,
  setXTenantId,
  trpc,
  untrackScopeFromSuspense,
} from "~/lib";
import { globalCtx } from "~/lib/globalCtx";

export default function Layout(props: ParentProps) {
  const params = useParams<{ tenant?: string }>();
  const navigate = useNavigate();
  const location = useLocation();

  // TODO: Use the auth cookie trick for better UX
  const session = trpc.auth.me.useQuery(void 0, () => ({
    // This will *always* stay in the cache. Avoids need for `localStorage` shenanigans.
    gcTime: Infinity,
  }));

  // This is not needed for `/` but it is for `/:tenantID`.
  // I assume it's something to do with the route being lazy loaded
  const untrackedSessionData = untrackScopeFromSuspense(() => session.data);

  const activeTenant = createMemo(() => {
    if (!params.tenant) return null; // We are probs on a 404 page

    const session = untrackedSessionData();

    const tenants = session?.tenants || [];
    const tenant = tenants.find((t) => t.id === params.tenant);

    // If the tenant doesn't exist, we clear it as active
    if (!tenant) {
      // We only fire the redirect if the server has responded
      if (session !== undefined)
        navigate(tenants?.[0] !== undefined ? `/${tenants[0].id}` : "/");

      return null;
    }

    // The tRPC link can't use `useGlobalCtx` so we need to leak the tenant id into the global scope
    setXTenantId(tenant.id);

    return tenant;
  });

  const setActiveTenant = (id: string) => {
    // TODO: It would be sick if `useParams` had a setter to avoid this manual URL manipulation
    let path = location.pathname.split("/");

    if (params.tenant) path[1] = id;
    else path = ["", id];

    navigate(path.join("/"));

    // TODO: Why is this timeout required??? After tenant create it doesn't redirect without it.
    setTimeout(
      () =>
        navigate(path.join("/"), {
          replace: true,
        }),
      250
    );
  };

  const refetchSession = async () => {
    const r = session.refetch();
    if (!r) return;
    await r;
  };

  return (
    <>
      <Suspense fallback={<SuspenseError name="Sidebar" />}>
        <LeftSidebar
          activeTenant={activeTenant()}
          tenants={session.data?.tenants || []}
          setActiveTenant={setActiveTenant}
          refetchSession={refetchSession}
        />
      </Suspense>

      <Suspense fallback={<h1>TODO: Loading...</h1>}>
        {/* TODO: Why does this always suspend even with an `initialValue` available */}
        <Show when={session.data}>
          {(session2) => (
            <globalCtx.Provider
              value={{
                get activeTenant() {
                  return activeTenant();
                },
                setActiveTenant,
                refetchSession,
                get session() {
                  return session2();
                },
              }}
            >
              <ErrorBoundary
                fallback={(err) => {
                  console.error(err);

                  return (
                    <div class="p-2">
                      <h1>Error</h1>
                      <pre>{err.message}</pre>
                    </div>
                  );
                }}
              >
                <Suspense fallback={<h1>Loading...</h1>}>
                  {props.children}
                </Suspense>
              </ErrorBoundary>
            </globalCtx.Provider>
          )}
        </Show>
      </Suspense>
    </>
  );
}
