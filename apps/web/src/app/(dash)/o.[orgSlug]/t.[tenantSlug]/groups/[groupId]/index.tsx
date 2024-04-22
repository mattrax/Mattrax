import { Suspense, createMemo, createSignal } from "solid-js";
import { A, type RouteDefinition } from "@solidjs/router";
import { Dynamic } from "solid-js/web";
import { toast } from "solid-sonner";
import { Button, Input, Label } from "@mattrax/ui";
import { As } from "@kobalte/core";
import pluralize from "pluralize";

import IconMaterialSymbolsEditOutline from "~icons/material-symbols/edit-outline.jsx";
import IconIcRoundCheck from "~icons/ic/round-check.jsx";
import { VariantTableSheet, variantTableColumns } from "~c/VariantTableSheet";
import { StandardTable, createStandardTable } from "~c/StandardTable";
import { PageLayout, PageLayoutHeading } from "~c/PageLayout";
import { useTenantSlug } from "../../../t.[tenantSlug]";
import { useGroup } from "./Context";
import { trpc } from "~/lib";
import { StatItem } from "~/components/StatItem";

export const route = {
  load: ({ params }) => {
    trpc.useContext().group.members.ensureData({
      id: params.groupId!,
    });
    trpc.useContext().group.assignments.ensureData({
      id: params.groupId!,
    });
  },
} satisfies RouteDefinition;

import IconPhDevices from "~icons/ph/devices";
import IconPhUser from "~icons/ph/user";

export default function Page() {
  return (
    <PageLayout
      heading={
        <>
          <NameEditor />
          {/* TODO: This show show policies */}
        </>
      }
    >
      <div class="flex flex-row gap-8">
        <div class="flex-1 space-y-4">
          <Members />
        </div>
        <div class="flex-1 space-y-4">
          <Assignments />
        </div>
      </div>
    </PageLayout>
  );
}

function NameEditor() {
  const group = useGroup();

  const updateGroup = trpc.group.update.createMutation(() => ({
    onSuccess: () => group.query.refetch(),
  }));

  const updateName = (name: string) => {
    if (name === "") {
      toast.error("Group name cannot be empty");
      return;
    }

    toast.promise(updateGroup.mutateAsync({ id: group().id, name }), {
      loading: "Updating group name...",
      success: "Group name updated",
      error: "Failed to update group name",
    });
  };

  const [editingName, setEditingName] = createSignal(false);
  let nameEl: HTMLHeadingElement;

  const [cachedName, setCachedName] = createSignal(group().name);
  const name = createMemo(() => (editingName() ? cachedName() : group().name));

  return (
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
            editingName() ? IconIcRoundCheck : IconMaterialSymbolsEditOutline
          }
        />
      </Button>
    </>
  );
}

function Members() {
  const group = useGroup();

  const members = trpc.group.members.createQuery(() => ({
    id: group().id,
  }));

  const membersTable = createStandardTable({
    get data() {
      return members.data ?? [];
    },
    columns: variantTableColumns.slice(1),
    // pagination: true, // TODO: Pagination
  });

  return (
    <>
      <div class="grid grid-cols-2 gap-4">
        <StatItem
          title="Users"
          href="members?variant=user"
          icon={<IconPhUser />}
          value={members.data?.filter((m) => m.variant === "user").length ?? 0}
        />
        <StatItem
          title="Devices"
          href="members?variant=device"
          icon={<IconPhDevices />}
          value={
            members.data?.filter((m) => m.variant === "device").length ?? 0
          }
        />
      </div>
      <div class="flex flex-row items-center justify-between">
        <Label class="flex-1">
          <A href="members" class="hover:underline w-full block">
            Members
          </A>
        </Label>
        <Input class="max-w-72" placeholder="Search members" disabled />
        {/* <VariantTableSheet
          title="Add Members"
          description="Add users and devices to this group."
          getSubmitText={(count) =>
            `Add ${count} ${pluralize("Member", count)}`
          }
          variants={variants}
          onSubmit={(members) =>
            addMembers.mutateAsync({
              id: group().id,
              members,
            })
          }
        >
          <As component={Button} class="ml-auto" size="sm">
            Add Members
          </As>
        </VariantTableSheet> */}
      </div>
      <Suspense>
        <StandardTable table={membersTable} />
      </Suspense>
    </>
  );
}

function Assignments() {
  const group = useGroup();

  const assignments = trpc.group.assignments.createQuery(() => ({
    id: group().id,
  }));

  const table = createStandardTable({
    get data() {
      if (!assignments.data) return [];

      return [
        ...assignments.data.policies.map((d) => ({ ...d, variant: "policy" })),
        ...assignments.data.apps.map((d) => ({ ...d, variant: "application" })),
      ];
    },
    columns: variantTableColumns.slice(1),
    // pagination: true, // TODO: Pagination
  });

  return (
    <>
      <div class="grid grid-cols-2 gap-4">
        <StatItem
          title="Policies"
          href="assignments?variant=policy"
          icon={<IconPhUser />}
          value={assignments.data?.policies.length ?? 0}
        />
        <StatItem
          title="Apps"
          href="assignments?variant=app"
          icon={<IconPhDevices />}
          value={assignments.data?.apps.length ?? 0}
        />
      </div>
      <div class="flex flex-row items-center justify-between">
        <Label class="flex-1">
          <A href="assignments" class="hover:underline w-full block">
            Assignments
          </A>
        </Label>
        <Input class="max-w-72" placeholder="Search assignments" disabled />
      </div>
      <Suspense>
        <StandardTable table={table} />
      </Suspense>
    </>
  );
}
