import { Navigate, useNavigate, useParams } from "@solidjs/router";
import {
  createMemo,
  ParentProps,
  Show,
  startTransition,
  Suspense,
} from "solid-js";
import { createContextProvider } from "@solid-primitives/context";
import { RouterOutput } from "@mattrax/api";

import { SuspenseError } from "~/lib";
import { useAuthContext } from "../(dash)";
import TopNav from "~/components/TopNav";
import { useZodParams } from "~/lib/useZodParams";
import { z } from "zod";

export const [TenantContextProvider, useTenantContext] = createContextProvider(
  (props: { activeTenant: RouterOutput["auth"]["me"]["tenants"][number] }) =>
    props,
  null!
);

export default function Layout(props: ParentProps) {
  const params = useZodParams({
    tenantId: z.coerce.number(),
  });
  const auth = useAuthContext();
  const navigate = useNavigate();

  const activeTenant = createMemo(() =>
    auth.me.tenants.find((t) => t.id === params.tenantId)
  );

  function setTenantId(id: number) {
    startTransition(() => navigate(`/${id}`));
  }

  return (
    <Show
      when={activeTenant()}
      fallback={
        <Navigate
          href={() => {
            const firstTenant = auth.me.tenants[0];
            return firstTenant?.id ? `../${firstTenant.id}` : "/";
          }}
        />
      }
    >
      {(activeTenant) => (
        <TenantContextProvider activeTenant={activeTenant()}>
          {/* we don't key the sidebar so that the tenant switcher closing animation can still play */}
          <Suspense fallback={<SuspenseError name="Sidebar" />}>
            <TopNav
              activeTenant={activeTenant()}
              tenants={auth.me.tenants}
              setActiveTenant={setTenantId}
              refetchSession={async () => {
                await auth.meQuery.refetch();
              }}
            />
          </Suspense>
          {/* we key here on purpose - tenants are the root-most unit of isolation */}
          <Show when={activeTenant().id} keyed>
            {props.children}
          </Show>
        </TenantContextProvider>
      )}
    </Show>
  );
}
