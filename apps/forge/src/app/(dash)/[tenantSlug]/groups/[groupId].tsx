import { createColumnHelper } from "@tanstack/solid-table";
import { Accessor, Show, Suspense } from "solid-js";
import { As } from "@kobalte/core";
import { z } from "zod";

import { Badge, Button } from "~/components/ui";
import { trpc } from "~/lib";
import { useZodParams } from "~/lib/useZodParams";
import { useTenantContext } from "../../[tenantSlug]";
import { AddMemberSheet } from "./AddMemberSheet";
import {
  StandardTable,
  createStandardTable,
  selectCheckboxColumn,
} from "~/components/StandardTable";

export default function Page() {
  const routeParams = useZodParams({ groupId: z.string() });

  const tenant = useTenantContext();
  const group = trpc.group.get.useQuery(() => ({
    id: routeParams.groupId,
    tenantSlug: tenant.activeTenant.slug,
  }));

  return (
    <Show when={group.data}>
      {(group) => {
        const table = createMembersTable(() => group().id);

        return (
          <div class="px-4 py-8 w-full max-w-5xl mx-auto flex flex-col gap-4">
            <div class="flex flex-row justify-between">
              <h1 class="text-3xl font-bold mb-4">{group().name}</h1>
              <AddMemberSheet groupId={routeParams.groupId}>
                <As component={Button}>Add Members</As>
              </AddMemberSheet>
            </div>

            <Suspense>
              <StandardTable table={table} />
            </Suspense>
          </div>
        );
      }}
    </Show>
  );
}

const VariantDisplay = {
  user: "User",
  device: "Device",
} as const;

type Variant = keyof typeof VariantDisplay;

const columnHelper = createColumnHelper<{
  pk: number;
  name: string;
  variant: Variant;
}>();

export const columns = [
  selectCheckboxColumn,
  columnHelper.accessor("name", { header: "Name" }),
  columnHelper.accessor("variant", {
    header: "Variant",
    cell: (info) => <Badge>{VariantDisplay[info.getValue()]}</Badge>,
  }),
];

function createMembersTable(groupId: Accessor<string>) {
  const tenant = useTenantContext();
  const members = trpc.group.members.useQuery(() => ({
    id: groupId(),
    tenantSlug: tenant.activeTenant.slug,
  }));

  return createStandardTable({
    get data() {
      return members.data ?? [];
    },
    columns,
  });
}
