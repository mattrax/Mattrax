import { Suspense, createMemo, createSignal } from "solid-js";
import { RouteDefinition } from "@solidjs/router";
import { Dynamic } from "solid-js/web";
import { toast } from "solid-sonner";
import { Button } from "@mattrax/ui";
import { As } from "@kobalte/core";

import IconMaterialSymbolsEditOutline from "~icons/material-symbols/edit-outline.jsx";
import IconIcRoundCheck from "~icons/ic/round-check.jsx";
import { trpc } from "~/lib";
import { PageLayout, PageLayoutHeading } from "~c/PageLayout";
import { StandardTable, createStandardTable } from "~c/StandardTable";
import {
  AddMemberSheet,
  memberSheetColumns,
} from "~[tenantSlug]/AddMemberSheet";
import { useGroup } from "./Context";
import { useTenantSlug } from "../../../t.[tenantSlug]";

export const route = {
  load: ({ params }) => {
    trpc.useContext().group.members.ensureData({
      id: params.groupId!,
    });
  },
} satisfies RouteDefinition;

export default function Page() {
  const tenantSlug = useTenantSlug();
  const group = useGroup();

  const updateGroup = trpc.group.update.createMutation(() => ({
    onSuccess: () => group.query.refetch(),
  }));

  const members = trpc.group.members.createQuery(() => ({
    id: group().id,
  }));

  const table = createStandardTable({
    get data() {
      return members.data ?? [];
    },
    columns: memberSheetColumns,
    // pagination: true, // TODO: Pagination
  });

  const updateName = (name: string) => {
    if (name === "") {
      toast.error("Group name cannot be empty");
      return;
    }

    toast.promise(
      updateGroup.mutateAsync({
        id: group().id,
        name,
      }),
      {
        loading: "Updating group name...",
        success: "Group name updated",
        error: "Failed to update group name",
      },
    );
  };

  const [editingName, setEditingName] = createSignal(false);
  let nameEl: HTMLHeadingElement;

  const [cachedName, setCachedName] = createSignal(group().name);
  const name = createMemo(() => (editingName() ? cachedName() : group().name));

  const addMembers = trpc.group.addMembers.createMutation(() => ({
    onSuccess: () => members.refetch(),
  }));

  const variants = {
    user: {
      label: "Users",
      query: trpc.tenant.members.users.createQuery(() => ({
        tenantSlug: tenantSlug(),
      })),
    },
    device: {
      label: "Devices",
      query: trpc.tenant.members.devices.createQuery(() => ({
        tenantSlug: tenantSlug(),
      })),
    },
  };

  return (
    <PageLayout
      heading={
        <>
          <PageLayoutHeading
            ref={nameEl!}
            class="p-2 -m-2"
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
          </PageLayoutHeading>
          <Button
            variant="link"
            size="iconSmall"
            class="text-lg"
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
            <Dynamic
              component={
                editingName()
                  ? IconIcRoundCheck
                  : IconMaterialSymbolsEditOutline
              }
            />
          </Button>
          {/* TODO: This show show policies */}
          <AddMemberSheet
            variants={variants}
            onSubmit={(members) =>
              addMembers.mutateAsync({
                id: group().id,
                members,
              })
            }
          >
            <As component={Button} class="ml-auto">
              Add Member
            </As>
          </AddMemberSheet>
        </>
      }
    >
      <Suspense>
        <StandardTable table={table} />
      </Suspense>
    </PageLayout>
  );
}
