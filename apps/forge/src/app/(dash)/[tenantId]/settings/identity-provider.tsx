import { For, Match, Show, Suspense, Switch, createMemo } from "solid-js";

import {
  Badge,
  Button,
  Card,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogRoot,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui";
import { trpc } from "~/lib";
import { useTenantContext } from "../../[tenantId]";
import { AUTH_PROVIDER_DISPLAY, authProviderUrl } from "~/lib/values";
import clsx from "clsx";
import { As } from "@kobalte/core";

export default function Page() {
  const tenant = useTenantContext();
  const trpcCtx = trpc.useContext();

  const linkEntra = trpc.tenant.auth.linkEntra.useMutation(() => ({
    onSuccess: async (url) => {
      window.open(url, "_self");
    },
  }));

  const provider = trpc.tenant.identityProvider.get.useQuery(() => ({
    tenantId: tenant.activeTenant.id,
  }));

  const refreshDomains =
    trpc.tenant.identityProvider.refreshDomains.useMutation(() => ({
      onSuccess: () =>
        trpcCtx.tenant.identityProvider.domains.refetch({
          tenantId: tenant.activeTenant.id,
        }),
    }));

  return (
    <div>
      <h1 class="text-2xl font-semibold">Identity Provider</h1>
      <p class="mt-2 mb-3 text-gray-700 text-sm">
        Sync user accounts and enroll devices by connecting an identity
        provider.
      </p>
      <Card class="p-4">
        <Show
          when={provider.data}
          fallback={
            <Button
              onClick={() =>
                linkEntra.mutate({ tenantId: tenant.activeTenant.id })
              }
              disabled={linkEntra.isPending}
            >
              Entra ID
            </Button>
          }
        >
          {(provider) => (
            <>
              <div class="flex flex-col text-sm gap-1 items-start">
                <a
                  class="font-semibold hover:underline flex flex-row items-center gap-1"
                  href={authProviderUrl(
                    provider().variant,
                    provider().remoteId
                  )}
                  target="_blank"
                >
                  {provider().name ?? AUTH_PROVIDER_DISPLAY[provider().variant]}
                  <IconPrimeExternalLink class="inline" />
                </a>
                <span class="text-gray-600">{provider().remoteId}</span>
              </div>
            </>
          )}
        </Show>
      </Card>
      <div class="mt-4 flex flex-row">
        <div>
          <h2 class="text-lg font-semibold">Domains</h2>
          <p class="mt-1 mb-3 text-gray-700 text-sm">
            Connect domains to sync users and enroll devices.
          </p>
        </div>
        <Show when={provider.data}>
          <Button
            class="ml-auto"
            onClick={() =>
              refreshDomains.mutate({
                tenantId: tenant.activeTenant.id,
              })
            }
            disabled={refreshDomains.isPending}
          >
            Refresh
          </Button>
        </Show>
      </div>
      <Suspense>
        <Show when={provider.data}>
          {(_) => {
            const domains = trpc.tenant.identityProvider.domains.useQuery(
              () => ({
                tenantId: tenant.activeTenant.id,
              })
            );

            const allDomains = createMemo(() => {
              const arr = [
                ...new Set([
                  ...(domains.data?.remoteDomains ?? []),
                  ...(domains.data?.connectedDomains?.map((d) => d.domain) ??
                    []),
                ]),
              ];

              arr.sort((a, b) => {
                const aData = domains.data?.connectedDomains.find(
                  (d) => d.domain === a
                );
                const bData = domains.data?.connectedDomains.find(
                  (d) => d.domain === b
                );

                if (aData === bData) return 0;
                if (aData) return -1;
                if (bData) return 1;
                return 0;
              });

              return arr;
            });

            return (
              <ul class="rounded border border-gray-200 divide-y divide-gray-200">
                <For each={allDomains()}>
                  {(domain) => {
                    const connectionData = createMemo(() =>
                      domains.data?.connectedDomains.find(
                        (d) => d.domain === domain
                      )
                    );

                    const state = createMemo(() => {
                      const data = connectionData();

                      if (data) {
                        if (!domains.data?.remoteDomains.includes(domain))
                          return { variant: "dangling" } as const;

                        return { variant: "connected", data } as const;
                      }

                      return { variant: "unconnected" };
                    });

                    return (
                      <li class="p-4 flex flex-row gap-2 items-center">
                        <div class="flex flex-col gap-1">
                          <span class="font-medium">
                            {domain}
                            <Show when={state().variant === "connected"}>
                              <Badge class="ml-2">Connected</Badge>
                            </Show>
                            <Show when={state().variant !== "connected"}>
                              <Badge class="ml-2" variant="outline">
                                Unconnected
                              </Badge>
                            </Show>
                          </span>
                          <div class="flex flex-row items-center gap-2">
                            <Switch>
                              <Match when={state().variant === "dangling"}>
                                <div class="w-6 h-6">
                                  <IconMaterialSymbolsWarningRounded class="w-6 h-6 text-yellow-600" />
                                </div>
                                <span class="text-sm text-gray-600">
                                  Domain is no longer connected to the identity
                                  provider
                                </span>
                              </Match>
                              <Match when={state().variant === "unconnected"}>
                                <span class="text-sm text-gray-600">
                                  Domain found in identity provider
                                </span>
                              </Match>
                              <Match
                                when={(() => {
                                  const s = state();
                                  if (s.variant === "connected") return s.data;
                                })()}
                              >
                                {(connectionData) => {
                                  const enterpriseEnrollment = () =>
                                    connectionData()
                                      .enterpriseEnrollmentAvailable;

                                  return (
                                    <>
                                      <div
                                        class={clsx(
                                          "w-6 h-6 rounded-full flex items-center justify-center text-white",
                                          enterpriseEnrollment()
                                            ? "bg-green-600"
                                            : "bg-red-600"
                                        )}
                                      >
                                        {enterpriseEnrollment() ? (
                                          <IconIcRoundCheck />
                                        ) : (
                                          <IconIcOutlineClose />
                                        )}
                                      </div>
                                      <span class="text-sm text-gray-600">
                                        {enterpriseEnrollment() ? (
                                          "Windows Automatic Enrollment configured"
                                        ) : (
                                          <>
                                            Windows Automatic Enrollment not
                                            configured
                                            <DialogRoot>
                                              <DialogTrigger asChild>
                                                <As
                                                  component={Button}
                                                  class="ml-2"
                                                  variant="outline"
                                                  size="iconSmall"
                                                >
                                                  ?
                                                </As>
                                              </DialogTrigger>
                                              <DialogContent class="max-w-auto">
                                                <DialogHeader>
                                                  <DialogTitle>
                                                    Windows Automatic Enrollment
                                                  </DialogTitle>
                                                  <DialogDescription>
                                                    To configure{" "}
                                                    <code>{domain}</code> for
                                                    Windows Automatic
                                                    Enrollment, add the
                                                    following CNAME record to it
                                                  </DialogDescription>
                                                </DialogHeader>
                                                <code>
                                                  {`CNAME enterpriseenrollment.${domain} mdm.mattrax.app`}
                                                </code>
                                              </DialogContent>
                                            </DialogRoot>
                                          </>
                                        )}
                                      </span>
                                    </>
                                  );
                                }}
                              </Match>
                            </Switch>
                          </div>
                        </div>
                        <div class="flex-1" />
                        <Switch>
                          <Match when={state().variant !== "unconnected"}>
                            {(_) => {
                              const removeDomain =
                                trpc.tenant.identityProvider.removeDomain.useMutation(
                                  () => ({ onSuccess: () => domains.refetch() })
                                );

                              return (
                                <Button
                                  onClick={() =>
                                    removeDomain.mutate({
                                      tenantId: tenant.activeTenant.id,
                                      domain,
                                    })
                                  }
                                  disabled={removeDomain.isPending}
                                >
                                  Disconnect
                                </Button>
                              );
                            }}
                          </Match>
                          <Match when={state().variant === "unconnected"}>
                            {(_) => {
                              const enableDomain =
                                trpc.tenant.identityProvider.connectDomain.useMutation(
                                  () => ({ onSuccess: () => domains.refetch() })
                                );

                              return (
                                <Button
                                  disabled={enableDomain.isPending}
                                  onClick={() =>
                                    enableDomain.mutate({
                                      tenantId: tenant.activeTenant.id,
                                      domain,
                                    })
                                  }
                                >
                                  Connect
                                </Button>
                              );
                            }}
                          </Match>
                        </Switch>
                      </li>
                    );
                  }}
                </For>
              </ul>
            );
          }}
        </Show>
      </Suspense>
    </div>
  );
}
