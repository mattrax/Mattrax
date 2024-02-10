import { As } from "@kobalte/core";
import { RouterOutput } from "@mattrax/api";
import {
  type ColumnDef,
  createSolidTable,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  createColumnHelper,
} from "@tanstack/solid-table";
import { Suspense } from "solid-js";
import { StandardTable } from "~/components/StandardTable";
import { Button } from "~/components/ui";
import { Badge } from "~/components/ui/badge";
import { trpc } from "~/lib";
import { AddDomainDialog } from "./AddDomainDialog";

const column =
  createColumnHelper<RouterOutput["tenant"]["domains"]["list"][number]>();

const columns = [
  column.accessor("domain", {
    header: "Domain",
  }),
  column.accessor("verified", {
    header: "Status",
    cell: (row) => {
      return (
        <Badge variant={row.getValue() ? "default" : "secondary"}>
          {row.getValue() ? "Verified" : "Unverified"}
        </Badge>
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
      <AddDomainDialog>
        <As component={Button} class="mb-4">
          Add Domain
        </As>
      </AddDomainDialog>

      <Suspense>
        <StandardTable table={table} />
      </Suspense>
    </>
  );
}
