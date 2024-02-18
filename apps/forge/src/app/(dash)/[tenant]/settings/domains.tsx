import { For, Show, Suspense, createEffect, onCleanup } from "solid-js";
import { createSignal } from "solid-js";
import { Dynamic } from "solid-js/web";

import {
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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "~/components/ui";
import { Badge } from "~/components/ui/badge";
import { trpc } from "~/lib";
import { Form, InputField, createZodForm } from "~/components/forms";
import { z } from "zod";
import { As } from "@kobalte/core";
import { ConfirmDialog } from "~/components/ConfirmDialog";
import { createTimeAgo } from "@solid-primitives/date";
import { useTenantContext } from "../../[tenant]";

export default function Page() {
  const tenant = useTenantContext();
  const domains = trpc.tenant.domains.list.useQuery(() => ({
    tenantId: tenant.activeTenant.id,
  }));

  return (
    <>
      <AddDomainForm />
      <Suspense>
        <ul class="space-y-4">
          <For each={domains.data || []}>
            {(domain) => {
              const trpcCtx = trpc.useContext();
              const verifyDomain = trpc.tenant.domains.verify.useMutation(
                () => ({
                  onSuccess() {
                    // TODO: Have the new data for this be returned in the single-round trip of the mutation.
                    trpcCtx.tenant.domains.list.refetch();
                  },
                })
              );

              createEffect(() => {
                if (
                  domain.verified &&
                  domain.certificateLastModified !== undefined
                )
                  return;

                const i = setInterval(
                  () =>
                    verifyDomain.mutate({
                      domain: domain.domain,
                      tenantId: tenant.activeTenant.id,
                    }),
                  5000
                );
                onCleanup(() => clearInterval(i));
              });

              const [showSecret, setShowSecret] = createSignal(false);

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
                          {domain.verified ? (
                            <Badge variant="default">Verified</Badge>
                          ) : (
                            <Badge variant="destructive">Unverified</Badge>
                          )}

                          <Button
                            class="ml-auto"
                            disabled={verifyDomain.isPending}
                            onClick={() => {
                              verifyDomain.mutate({
                                domain: domain.domain,
                                tenantId: tenant.activeTenant.id,
                              });
                            }}
                          >
                            Refresh
                          </Button>
                          <ConfirmDialog>
                            {(confirm) => {
                              const deleteDomain =
                                trpc.tenant.domains.delete.useMutation(() => ({
                                  onSuccess() {
                                    trpcCtx.tenant.domains.list.refetch();
                                  },
                                }));

                              return (
                                <Button
                                  variant="destructive"
                                  onClick={() =>
                                    confirm({
                                      title: "Delete Domain",
                                      description: (
                                        <>
                                          Are you sure you want to delete{" "}
                                          <b>{domain.domain}</b>?
                                        </>
                                      ),
                                      action: "Delete",
                                      onConfirm: () =>
                                        deleteDomain.mutateAsync({
                                          domain: domain.domain,
                                          tenantId: tenant.activeTenant.id,
                                        }),
                                    })
                                  }
                                >
                                  Delete
                                </Button>
                              );
                            }}
                          </ConfirmDialog>
                        </div>

                        <Show
                          when={timeSinceCertIssued}
                          fallback={
                            <>
                              {domain.verified ? (
                                <p class="text-sm text-gray-500 pb-2">
                                  Issuing certificate...
                                </p>
                              ) : null}
                            </>
                          }
                        >
                          {(timeSinceCertIssued) => (
                            <p class="text-sm text-gray-500 pb-2">
                              Certificate issued {timeSinceCertIssued()()}
                            </p>
                          )}
                        </Show>
                      </div>

                      <Label>Verification Secret</Label>
                      <div class="flex flex-row items-center gap-2 h-8">
                        <Button
                          onClick={() => setShowSecret(!showSecret())}
                          variant="ghost"
                          size="iconSmall"
                        >
                          <Dynamic
                            component={
                              showSecret()
                                ? IconClarityEyeHideLine
                                : IconClarityEyeShowLine
                            }
                            class="w-5 h-5"
                          />
                        </Button>
                        <Show when={showSecret()} fallback="•••••••••••••••">
                          {(_) => {
                            const [copied, setCopied] = createSignal(false);

                            return (
                              <Tooltip
                                onOpenChange={(o) => {
                                  if (o) setCopied(false);
                                }}
                                openDelay={0}
                                closeDelay={0}
                                placement="top"
                              >
                                <TooltipTrigger>
                                  <code
                                    class="cursor-pointer bg-gray-100 p-1 rounded"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      navigator.clipboard.writeText(
                                        domain.secret
                                      );
                                      setCopied(true);
                                    }}
                                  >
                                    {domain.secret}
                                  </code>
                                </TooltipTrigger>
                                <TooltipContent
                                  onPointerDownOutside={(e) =>
                                    e.preventDefault()
                                  }
                                >
                                  {copied() ? "Copied!" : "Click to copy"}
                                </TooltipContent>
                              </Tooltip>
                            );
                          }}
                        </Show>
                      </div>

                      <Label>Windows Automatic Enrollment</Label>
                      <div class="text-gray-700 flex flex-row items-center gap-2 text-sm h-8">
                        {domain.enterpriseEnrollmentAvailable ? (
                          <>
                            <div class="p-1 rounded-full bg-green-600">
                              <IconIcRoundCheck class="w-4 h-4 text-white" />
                            </div>
                            CNAME Found
                          </>
                        ) : (
                          <>
                            <div class="p-1 rounded-full bg-red-600">
                              <IconIcOutlineClose class="w-4 h-4 text-white" />
                            </div>
                            CNAME Not Found
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

function AddDomainForm() {
  const createDomain = trpc.tenant.domains.create.useMutation();
  const trpcCtx = trpc.useContext();

  const tenant = useTenantContext();
  const form = createZodForm({
    schema: z.object({ domain: z.string() }),
    async onSubmit({ value }) {
      await createDomain.mutateAsync({
        domain: value.domain,
        tenantId: tenant.activeTenant.id,
      });
      await trpcCtx.tenant.domains.list.refetch();
      form.setFieldValue("domain", "");
    },
  });

  return (
    <Form form={form} class="mb-4" fieldsetClass="flex flex-row gap-4">
      <InputField
        placeholder="mydomain.com"
        form={form}
        name="domain"
        fieldClass="flex-1"
      />
      <Button type="submit" class="shrink-0">
        Add Domain
      </Button>
    </Form>
  );
}
