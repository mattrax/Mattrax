import { redirect, useNavigate, useParams } from "@solidjs/router";
import { useLocation } from "@solidjs/router";
import {
  ErrorBoundary,
  ParentProps,
  Suspense,
  createEffect,
  createMemo,
  createResource,
} from "solid-js";
import LeftSidebar from "~/components/LeftSidebar";
import { globalCtx } from "~/utils/globalCtx";
import { client } from "~/utils";
import { InferResponseType } from "hono/client";

export default function Layout(props: ParentProps) {
  const params = useParams<{ tenant?: string }>();
  const navigate = useNavigate();
  const location = useLocation();

  // TODO: Use indexedDB + move to cache abstraction

  let initialSession = undefined;
  const raw = localStorage.getItem("session");
  if (raw)
    try {
      initialSession = JSON.parse(raw);
    } catch (err) {
      console.warn("Error decoding session from localStorage", err);
    }

  // TODO: Use the auth cookie trick for better UX
  const [session] = createResource(
    () =>
      // TODO: Loading states + error handling
      client.api.auth.me.$get().then((r) => {
        console.log(r.status);
        if (r.status === 401) throw redirect("/login");
        return r.json();
      }),
    {
      initialValue: initialSession as InferResponseType<
        typeof client.api.auth.me
      >,
    }
  );

  createEffect(() => {
    if (session.latest === undefined) return;
    localStorage.setItem("session", JSON.stringify(session.latest));
  });

  const activeTenant = createMemo(() => {
    if (!params.tenant) return null; // We are probs on a 404 page

    const tenants = session.latest?.tenants || [];
    const tenant = tenants.find((t) => t.id === params.tenant);

    // If the tenant doesn't exist, we clear it as active
    if (!tenant)
      throw redirect(tenants?.[0] !== undefined ? `/${tenants[0].id}` : "/");

    return tenant;
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
        tenants={session.latest.tenants || []}
        setActiveTenant={setActiveTenant}
      />

      <Suspense fallback={<h1>TODO: Loading...</h1>}>
        <globalCtx.Provider
          value={{
            get activeTenant() {
              return activeTenant();
            },
            setActiveTenant,
            get session() {
              return session();
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
            {props.children}
          </ErrorBoundary>
        </globalCtx.Provider>
      </Suspense>
    </>
  );
}
