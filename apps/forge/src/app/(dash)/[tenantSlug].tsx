import { createContextProvider } from "@solid-primitives/context";
import { Navigate, useNavigate } from "@solidjs/router";
import {
  ErrorBoundary,
  ParentProps,
  Show,
  Suspense,
  createMemo,
  startTransition,
} from "solid-js";
import { z } from "zod";
import { RouterOutput } from "~/api/trpc";

import { Button } from "~/components/ui";
import { SuspenseError } from "~/lib";
import { useZodParams } from "~/lib/useZodParams";
import { useAuthContext } from "../(dash)";
import TopNav from "./[tenantSlug]/TopNav";

export const [TenantContextProvider, useTenantContext] = createContextProvider(
  (props: { activeTenant: RouterOutput["auth"]["me"]["tenants"][number] }) =>
    props,
  null!,
);

export default function Layout(props: ParentProps) {
  const params = useZodParams({
    tenantSlug: z.string(),
  });
  const auth = useAuthContext();
  const navigate = useNavigate();

  const activeTenant = createMemo(() =>
    auth.me.tenants.find((t) => t.slug === params.tenantSlug),
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
          <ErrorBoundary
            fallback={(err, reset) => (
              <div class="flex flex-col items-center justify-center h-full gap-4">
                <h1 class="text-3xl font-semibold">Failed To Load Mattrax</h1>
                <p class="text-gray-600">{err.toString()}</p>
                <Button onClick={reset}>Reload</Button>
              </div>
            )}
          >
            {/* we key here on purpose - tenants are the root-most unit of isolation */}
            <Show when={activeTenant().id} keyed>
              {props.children}
            </Show>
          </ErrorBoundary>
        </TenantContextProvider>
      )}
    </Show>
  );
}
