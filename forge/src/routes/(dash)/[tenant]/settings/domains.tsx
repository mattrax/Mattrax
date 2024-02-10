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
  Input,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "~/components/ui";
import { Badge } from "~/components/ui/badge";
import { trpc } from "~/lib";
import { Form, InputField, createZodForm } from "~/components/forms";
import { z } from "zod";

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
      const [show, setShow] = createSignal(false);

      return (
        <div class="flex flex-row items-center gap-2">
          <Button
            onClick={() => setShow(!show())}
            variant="ghost"
            size="iconSmall"
          >
            <Dynamic
              component={
                show() ? IconClarityEyeHideLine : IconClarityEyeShowLine
              }
              class="w-5 h-5"
            />
          </Button>
          <Show when={show()} fallback="•••••••••••••••">
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
                        navigator.clipboard.writeText(props.getValue());
                        setCopied(true);
                      }}
                    >
                      {props.getValue()}
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
      );
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
        <StandardTable table={table} />
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
