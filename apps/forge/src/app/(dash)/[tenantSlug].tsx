import { Navigate, useNavigate } from "@solidjs/router";
import {
  createMemo,
  ParentProps,
  Show,
  startTransition,
  Suspense,
} from "solid-js";
import { createContextProvider } from "@solid-primitives/context";
import { RouterOutput } from "~/api/trpc";
import { z } from "zod";

import { SuspenseError } from "~/lib";
import { useAuthContext } from "../(dash)";
import TopNav from "./[tenantSlug]/TopNav";
import { useZodParams } from "~/lib/useZodParams";

export const [TenantContextProvider, useTenantContext] = createContextProvider(
  (props: { activeTenant: RouterOutput["auth"]["me"]["tenants"][number] }) =>
    props,
  null!
);

export default function Layout(props: ParentProps) {
  const params = useZodParams({
    tenantSlug: z.string(),
  });
  const auth = useAuthContext();
  const navigate = useNavigate();

  const activeTenant = createMemo(() =>
    auth.me.tenants.find((t) => t.slug === params.tenantSlug)
  );

  function setTenantSlug(slug: string) {
    startTransition(() => navigate(`../${slug}`));
  }

  return (
    <Show
      when={activeTenant()}
      fallback={
        <Navigate
          href={() => {
            const firstTenant = auth.me.tenants[0];
            return firstTenant?.slug ? `../${firstTenant.slug}` : "/";
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
              setActiveTenant={setTenantSlug}
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
