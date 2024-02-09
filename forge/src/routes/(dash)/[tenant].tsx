import { useMatch, useNavigate, useParams } from "@solidjs/router";
import {
  createMemo,
  ParentProps,
  Show,
  startTransition,
  Suspense,
} from "solid-js";
import { createContextProvider } from "@solid-primitives/context";
import { RouterOutput } from "@mattrax/api";
import { createComputed } from "solid-js";

import { SuspenseError, setXTenantId } from "~/lib";
import { useAuthContext } from "../(dash)";
import LeftSidebar from "~/components/LeftSidebar";

export const [TenantContextProvider, useTenantContext] = createContextProvider(
  (props: {
    activeTenant: RouterOutput["auth"]["me"]["tenants"][number];
    setTenantId: (id: string) => void;
  }) => props,
  null!
);

export default function Layout(props: ParentProps) {
  const params = useParams<{ tenant: string }>();
  const auth = useAuthContext();
  const navigate = useNavigate();

  createComputed(() => setXTenantId(params.tenant));

  const activeTenant = createMemo(() => {
    const ownedTenant = auth.me.tenants.find((t) => t.id === params.tenant);

    if (!ownedTenant) {
      const firstTenant = auth.me.tenants[0];
      navigate(firstTenant?.id ? `../${firstTenant.id}` : "/", {
        replace: true,
      });
      return;
    }

    return ownedTenant;
  });

  const match = useMatch(() => "/:tenant/*rest");

  function setTenantId(id: string) {
    startTransition(() => navigate(`/${id}/${match()!.params.rest}`));
  }

  return (
    // we key here on purpose - tenants are the root-most unit of isolation
    <Show when={activeTenant()} keyed>
      {(activeTenant) => (
        <TenantContextProvider
          activeTenant={activeTenant}
          setTenantId={setTenantId}
        >
          <Suspense fallback={<SuspenseError name="Sidebar" />}>
            <LeftSidebar
              activeTenant={activeTenant}
              tenants={auth.me.tenants}
              setActiveTenant={setTenantId}
              refetchSession={async () => {
                await auth.meQuery.refetch();
              }}
            />
          </Suspense>
          {props.children}
        </TenantContextProvider>
      )}
    </Show>
  );
}
