import { RouterOutput } from "@mattrax/api";
import {
  createSolidTable,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  createColumnHelper,
} from "@tanstack/solid-table";
import { Show, Suspense } from "solid-js";
import { toast } from "solid-sonner";
import { createSignal } from "solid-js";
import { Dynamic } from "solid-js/web";

import { StandardTable } from "~/components/StandardTable";
import {
  Button,
  Card,
  CardContent,
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

const column =
  createColumnHelper<RouterOutput["tenant"]["domains"]["list"][number]>();

const columns = [
  column.accessor("domain", {
    header: "Domain",
    size: 1,
  }),
  column.accessor("verified", {
    header: "Status",
    size: 1,
    cell: (row) => {
      return (
        <Badge variant={row.getValue() ? "default" : "secondary"}>
          {row.getValue() ? "Verified" : "Unverified"}
        </Badge>
      );
    },
  }),
  column.accessor("secret", {
    header: "Secret",
    cell: (props) => {
      return <div class="flex flex-row items-center gap-2"></div>;
    },
  }),
  column.display({
    id: "verify",
    size: 1,
    cell: ({ row }) => {
      const trpcCtx = trpc.useContext();
      const verifyDomain = trpc.tenant.domains.verify.useMutation(() => ({
        onSuccess(verified) {
          if (verified) {
            trpcCtx.tenant.domains.list.refetch();
            toast.success("Domain verified");
          } else toast.error("Domain not configured properly");
        },
      }));

      return (
        <Button
          disabled={verifyDomain.isPending}
          onClick={() =>
            verifyDomain.mutate({ domain: row.getValue("domain") })
          }
        >
          Verify
        </Button>
      );
    },
  }),
];

export default function Page() {
  const domains = trpc.tenant.domains.list.useQuery();

  const table = createSolidTable({
    get data() {
      return domains.data || [];
    },
    get columns() {
      return columns;
    },
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    defaultColumn: {
      // @ts-expect-error // TODO: This property's value should be a number but setting it to string works ¯\_(ツ)_/¯
      size: "auto",
    },
  });

  return (
    <>
      <AddDomainForm />
      <Suspense>
        <ul class="space-y-4">
          {domains.data?.map((domain) => {
            const trpcCtx = trpc.useContext();
            const verifyDomain = trpc.tenant.domains.verify.useMutation(() => ({
              onSuccess() {
                trpcCtx.tenant.domains.list.refetch();
              },
            }));

            const [showSecret, setShowSecret] = createSignal(false);

            return (
              <li>
                <Card>
                  <CardHeader>
                    <div class="flex flex-row items-center gap-2 pb-2">
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
                          verifyDomain.mutate({ domain: domain.domain });
                        }}
                      >
                        Refresh
                      </Button>
                      <Button variant="destructive">Delete</Button>
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
                                onPointerDownOutside={(e) => e.preventDefault()}
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
                                  supported by Windows Automatic Enrollment, you
                                  need to add a CNAME record to it.
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
          })}
        </ul>
      </Suspense>
    </>
  );
}

function AddDomainForm() {
  const createDomain = trpc.tenant.domains.create.useMutation();
  const trpcCtx = trpc.useContext();

  const form = createZodForm({
    schema: z.object({ domain: z.string() }),
    async onSubmit({ value }) {
      await createDomain.mutateAsync(value);
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
