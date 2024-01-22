import { Navigate, createAsync, useNavigate, useParams } from "@solidjs/router";
import invariant from "tiny-invariant";
import { useLocation } from "@solidjs/router";
import {
  ErrorBoundary,
  Match,
  ParentProps,
  Suspense,
  Switch,
  createMemo,
} from "solid-js";
import LeftSidebar from "~/components/LeftSidebar";
import { globalCtx } from "~/utils/globalCtx";
import { client } from "~/utils";

export default function Layout(props: ParentProps) {
  const params = useParams<{ tenant?: string }>();
  const navigate = useNavigate();
  const location = useLocation();

  // TODO: Caching this so it doesn't block page load (use the cookie trick for better UX)
  const session = createAsync(() =>
    // TODO: Loading states + error handling
    client.api.auth.me
      .$get()
      .then(async (r) =>
        r.status === 401 ? "unauthenticated" : await r.json()
      )
  );

  // TODO: Probally removing this now that it's on `session`???
  const tenants = () => {
    const s = session();
    if (s === "unauthenticated") return undefined;
    return s?.tenants || [];
  };

  const activeTenantForJsx = createMemo(() => {
    const t = tenants();
    if (tenants() === undefined) return null; // Tenants still fetching
    if (!params.tenant) return null; // We are probs on a 404 page

    const tenant = t?.find((t) => t.id === params.tenant);
    // If the tenant doesn't exist, we clear it as active
    return tenant || "not_found";
  });
  const activeTenant = createMemo(() => {
    const t = activeTenantForJsx();
    if (t === "not_found") return null;
    return t;
  });

  const setActiveTenant = (id: string) => {
    // TODO: It would be sick if `useParams` had a setter to avoid this manual URL manipulation
    let path = location.pathname.split("/");

    if (params.tenant) path[1] = id;
    else path = ["", id];

    navigate(path.join("/"));
  };

  return (
    <>
      <LeftSidebar
        activeTenant={activeTenant()}
        tenants={tenants() || []}
        setActiveTenant={setActiveTenant}
      />

      <Suspense fallback={<h1>TODO: Loading...</h1>}>
        <Switch fallback={<div>TODO: Loading match...</div>}>
          <Match when={session() === "unauthenticated"}>
            <Navigate href="/login" />
          </Match>
          <Match when={activeTenantForJsx() === "not_found"}>
            <Navigate
              href={() => {
                const t = tenants();
                return t?.[0] !== undefined ? `/${t[0].id}` : "/";
              }}
            />
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
                <ErrorBoundary
                  fallback={(err) => (
                    <div class="p-2">
                      <h1>Error</h1>
                      <pre>{err.message}</pre>
                    </div>
                  )}
                >
                  {props.children}
                </ErrorBoundary>
              </globalCtx.Provider>
            )}
          </Match>
        </Switch>
      </Suspense>
    </>
  );
}
