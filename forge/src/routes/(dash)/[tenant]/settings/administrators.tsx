import { RouterOutput } from "@mattrax/api";
import {
  createColumnHelper,
  createSolidTable,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
} from "@tanstack/solid-table";
import { Suspense } from "solid-js";

import { StandardTable } from "~/components/StandardTable";
import { trpc } from "~/lib";

const column =
  createColumnHelper<RouterOutput["tenant"]["administrators"][number]>();

const columns = [
  column.accessor("name", {
    header: "Name",
  }),
  column.accessor("email", {
    header: "Email",
  }),
];

export default function Page() {
  const administrators = trpc.tenant.administrators.useQuery();

  const table = createSolidTable({
    get data() {
      return administrators.data || [];
    },
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  return (
    <Suspense>
      <StandardTable table={table} />
    </Suspense>
  );
}
