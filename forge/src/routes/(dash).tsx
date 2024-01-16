import { Navigate, createAsync, useNavigate, useParams } from "@solidjs/router";
import invariant from "tiny-invariant";
import { useLocation } from "@solidjs/router";
import { Match, ParentProps, Suspense, Switch, createMemo } from "solid-js";
import LeftSidebar from "~/components/LeftSidebar";
import { sessionLoader, globalCtx, tenantLoader } from "~/utils/globalCtx";

export default function Layout(props: ParentProps) {
  const params = useParams<{ tenant?: string }>();
  const navigate = useNavigate();
  const location = useLocation();

  // These loaders are separate so we can render the `Redirect` without needing to wait for the tenants for better UX.
  const session = createAsync(sessionLoader, {
    // This triggers a redirect so it *must* be deferred
    deferStream: true,
  });
  // TODO: Load from `localStorage` and use while waiting to render???
  const tenants = createAsync(async () => {
    const s = session();
    if (!s || s === "unauthenticated") return undefined;
    return await tenantLoader(s.id);
  });

  const activeTenant = createMemo(() => {
    const tenant = tenants()?.find((t) => t.id === params.tenant);
    // If the tenant is removed, we clear it as active
    if (!tenant) {
      const t = tenants();
      navigate(t?.[0] !== undefined ? `/tenants/${t[0].id}` : "/");
      return null;
    }
    return tenant;
  });

  const setActiveTenant = (id: string) => {
    // TODO: It would be sick if `useParams` had a setter to avoid this manual URL manipulation
    const path = location.pathname.split("/");
    path[1] = id;
    navigate(path.join("/"));
  };

  return (
    <>
      <LeftSidebar activeTenant={activeTenant()} tenants={tenants() || []} />

      <Suspense fallback={<h1>TODO: Loading...</h1>}>
        <Switch fallback={<div>TODO: Loading match...</div>}>
          <Match when={session() === "unauthenticated"}>
            <Navigate href="/login" />
          </Match>
          <Match
            when={(() => {
              const s = session();
              const t = tenants();
              invariant(s !== "unauthenticated", "session not authed");
              return s && t ? { session: s, tenants: t } : undefined;
            })()}
          >
            {(data) => (
              <globalCtx.Provider
                value={{
                  activeTenant: activeTenant(),
                  setActiveTenant,
                  ...data(),
                }}
              >
                {props.children}
              </globalCtx.Provider>
            )}
          </Match>
        </Switch>
      </Suspense>
    </>
  );
}
