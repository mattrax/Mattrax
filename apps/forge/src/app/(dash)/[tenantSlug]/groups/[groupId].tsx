import { createColumnHelper } from "@tanstack/solid-table";
import { debounce } from "@solid-primitives/scheduled";
import {
  Accessor,
  Show,
  Suspense,
  createEffect,
  createMemo,
  createSignal,
} from "solid-js";
import { As } from "@kobalte/core";
import { z } from "zod";

import { Badge, Button, Input } from "~/components/ui";
import { trpc } from "~/lib";
import { useZodParams } from "~/lib/useZodParams";
import { useTenantContext } from "../../[tenantSlug]";
import { AddMemberSheet } from "./AddMemberSheet";
import {
  StandardTable,
  createStandardTable,
  selectCheckboxColumn,
} from "~/components/StandardTable";
import { toast } from "solid-sonner";

export default function Page() {
  const routeParams = useZodParams({ groupId: z.string() });

  const tenant = useTenantContext();
  const group = trpc.group.get.useQuery(() => ({
    id: routeParams.groupId,
    tenantSlug: tenant.activeTenant.slug,
  }));

  const updateGroup = trpc.group.update.useMutation(() => ({
    onSuccess: () => group.refetch(),
  }));

  return (
    <Show when={group.data}>
      {(group) => {
        const table = createMembersTable(() => group().id);

        const updateName = (name: string) => {
          if (name === "") {
            toast.error("Group name cannot be empty");
            return;
          }

          toast.promise(
            updateGroup.mutateAsync({
              tenantSlug: tenant.activeTenant.slug,
              id: group().id,
              name,
            }),
            {
              loading: "Updating group name...",
              success: "Group name updated",
              error: "Failed to update group name",
            }
          );
        };

        const [editingName, setEditingName] = createSignal(false);

        let nameEl: HTMLHeadingElement;

        const [cachedName, setCachedName] = createSignal(group().name);
        const name = createMemo(() =>
          editingName() ? cachedName() : group().name
        );

        return (
          <div class="px-4 w-full max-w-5xl mx-auto flex flex-col">
            <div class="flex flex-row items-center py-8 gap-4">
              <div class="flex flex-row items-center gap-4 flex-1 h-10">
                <h1
                  ref={nameEl!}
                  class="text-3xl font-bold p-2 -m-2"
                  contenteditable={editingName()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      e.currentTarget.blur();
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      setEditingName(false);
                    }
                  }}
                >
                  {name()}
                </h1>
                <Button
                  variant="link"
                  size="iconSmall"
                  class="text-xl"
                  onClick={() => {
                    setEditingName((e) => !e);
                    if (editingName()) {
                      setCachedName(group().name);

                      nameEl.focus();
                    } else {
                      updateName(nameEl.textContent ?? "");
                    }
                  }}
                >
                  {editingName() ? (
                    <IconIcRoundCheck />
                  ) : (
                    <IconMaterialSymbolsEditOutline />
                  )}
                </Button>
              </div>
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
