import { Suspense } from "solid-js";
import { createColumnHelper } from "@tanstack/solid-table";
import { As } from "@kobalte/core";
import { A, useNavigate } from "@solidjs/router";
import { RouterOutput } from "~/api/trpc";
import dayjs from "dayjs";

import { Button, Input } from "~/components/ui";
import {
  ColumnsDropdown,
  StandardTable,
  createStandardTable,
  selectCheckboxColumn,
} from "~/components/StandardTable";
import { trpc, untrackScopeFromSuspense } from "~/lib";
import { useTenantContext } from "../../[tenantSlug]";

const column = createColumnHelper<RouterOutput["device"]["list"][number]>();

export const columns = [
  selectCheckboxColumn,
  column.accessor("name", {
    header: "Name",
    cell: (props) => (
      <A
        class="font-medium hover:underline focus:underline p-1 -m-1 w-full block"
        href={props.row.original.id}
      >
        {props.getValue()}
      </A>
    ),
  }),
  column.accessor("operatingSystem", { header: "Operating System" }),
  column.accessor("serialNumber", { header: "Serial Number" }),
  column.accessor("owner", {
    header: "Owner",
    // TODO: Render as link with the user's name
  }),
  column.accessor("lastSynced", {
    header: "Last Synced",
    // TODO: Make time automatically update
    cell: (cell) => dayjs(cell.getValue()).fromNow(),
  }),
  column.accessor("enrolledAt", {
    header: "Enrolled At",
    // TODO: Make time automatically update
    cell: (cell) => dayjs(cell.getValue()).fromNow(),
  }),
];

function createDevicesTable() {
  const tenant = useTenantContext();
  const devices = trpc.device.list.useQuery(() => ({
    tenantSlug: tenant.activeTenant.slug,
  }));

  const table = createStandardTable({
    get data() {
      return devices.data || [];
    },
    columns,
  });

  return { devices, table };
}

// TODO: Infinite scroll

// TODO: Disable search, filters and sort until all backend metadata has loaded in. Show tooltip so it's clear what's going on.

export default function Page() {
  // const location = useLocation();
  const navigate = useNavigate();
  const { table, devices } = createDevicesTable();
  const isLoading = untrackScopeFromSuspense(() => devices.isLoading);

  return (
    <div class="px-4 py-8 w-full max-w-5xl mx-auto flex flex-col gap-4">
      <div class="flex justify-between">
        <h1 class="text-3xl font-bold mb-4">Devices</h1>
        {/* // TODO: Put this somewhere but make it logical and right here is not it */}
        {/* <Button
          onClick={() =>
            navigate("/enroll", {
              state: {
                backUrl: location.pathname,
              },
            })
          }
        >
          Enroll Device
        </Button> */}
      </div>
      <div class="flex flex-row items-center gap-4">
        <Input
          class="flex-1"
          placeholder={isLoading() ? "Loading..." : "Search..."}
          disabled={isLoading()}
          value={(table.getColumn("name")?.getFilterValue() as string) ?? ""}
          onInput={(event) =>
            table.getColumn("name")?.setFilterValue(event.target.value)
          }
        />
        <ColumnsDropdown table={table}>
          <As component={Button} variant="outline" class="ml-auto select-none">
            Columns
            <IconCarbonCaretDown class="ml-2 h-4 w-4" />
          </As>
        </ColumnsDropdown>
      </div>
      <Suspense>
        <StandardTable table={table} />
        <div class="flex items-center justify-end space-x-2">
          <div class="flex-1 text-sm text-muted-foreground">
            {table.getFilteredSelectedRowModel().rows.length} of{" "}
            {table.getFilteredRowModel().rows.length} row(s) selected.
          </div>
          <div class="space-x-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              Next
            </Button>
          </div>
        </div>
      </Suspense>
    </div>
  );
}
