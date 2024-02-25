import { For, Show, Suspense } from "solid-js";
import { As } from "@kobalte/core";
import { createTimeAgo } from "@solid-primitives/date";
import { toast } from "solid-sonner";

import {
  Badge,
  Button,
  Card,
  CardHeader,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogRoot,
  DialogTitle,
  DialogTrigger,
  Label,
} from "~/components/ui";
import { trpc } from "~/lib";
import { useTenantContext } from "../../[tenantId]";
import { AUTH_PROVIDER_DISPLAY, userAuthProviderUrl } from "~/lib/values";

export default function Page() {
  const tenant = useTenantContext();
  const domains = trpc.tenant.domains.list.useQuery(() => ({
    tenantId: tenant.activeTenant.id,
  }));
  const syncDomains = trpc.tenant.domains.sync.useMutation();

  return (
    <>
      <Button
        disabled={syncDomains.isPending}
        onClick={() =>
          toast.promise(
            syncDomains.mutateAsync({ tenantId: tenant.activeTenant.id }),
            {
              loading: "Syncing Domains...",
              success: "Domains synced!",
              error: "Failed to sync domains",
            }
          )
        }
      >
        Sync
      </Button>
      <Suspense>
        <ul class="space-y-4">
          <For each={domains.data || []}>
            {(domain) => {
              const timeSinceCertIssued = domain.certificateLastModified
                ? createTimeAgo(domain.certificateLastModified)[0]
                : undefined;

              return (
                <li>
                  <Card>
                    <CardHeader>
                      <div>
                        <div class="flex flex-row items-center gap-2">
                          <h4 class="text-xl font-semibold">{domain.domain}</h4>
                          <Badge variant="outline">
                            {
                              AUTH_PROVIDER_DISPLAY[
                                domain.userProvider!.variant
                              ]
                            }
                          </Badge>
                        </div>
                        <Show when={timeSinceCertIssued}>
                          {(timeSinceCertIssued) => (
                            <p class="text-sm text-gray-500 pb-2">
                              Certificate issued {timeSinceCertIssued()()}
                            </p>
                          )}
                        </Show>
                      </div>

                      <div class="text-gray-700 flex flex-row items-center gap-2 text-sm h-8">
                        {domain.enterpriseEnrollmentAvailable ? (
                          <>
                            <div class="p-1 rounded-full bg-green-600">
                              <IconIcRoundCheck class="w-4 h-4 text-white" />
                            </div>
                            Enrollment CNAME Found
                          </>
                        ) : (
                          <>
                            <div class="p-1 rounded-full bg-red-600">
                              <IconIcOutlineClose class="w-4 h-4 text-white" />
                            </div>
                            Enrollment CNAME Not Found
                            <DialogRoot>
                              <DialogTrigger asChild>
                                <As
                                  component={Button}
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
                                    For <code>{domain.domain}</code> to be
                                    supported by Windows Automatic Enrollment,
                                    you need to add a CNAME record to it.
                                  </DialogDescription>
                                </DialogHeader>
                                <code>
                                  {`CNAME enterpriseenrollment.${domain.domain} mdm.mattrax.app`}
                                </code>
                              </DialogContent>
                            </DialogRoot>
                          </>
                        )}
                      </div>
                    </CardHeader>
                  </Card>
                </li>
              );
            }}
          </For>
        </ul>
      </Suspense>
    </>
  );
}
