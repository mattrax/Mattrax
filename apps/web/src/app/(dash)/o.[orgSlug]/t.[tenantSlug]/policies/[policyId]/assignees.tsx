import { As } from "@kobalte/core";
import { Suspense } from "solid-js";

import { Button } from "@mattrax/ui";
import { trpc } from "~/lib";
import { usePolicy } from "./Context";
import { PageLayout, PageLayoutHeading } from "~c/PageLayout";
import { StandardTable, createStandardTable } from "~c/StandardTable";
import {
  AddMemberSheet,
  memberSheetColumns,
} from "~[tenantSlug]/AddMemberSheet";
import { useTenantSlug } from "../../../t.[tenantSlug]";

export default function Page() {
  const policy = usePolicy();
  const tenantSlug = useTenantSlug();

  const members = trpc.policy.members.createQuery(() => ({
    id: policy().id,
  }));

  const table = createStandardTable({
    get data() {
      return members.data ?? [];
    },
    columns: memberSheetColumns,
    pagination: true,
  });

  const addMembers = trpc.policy.addMembers.createMutation(() => ({
    onSuccess: () => members.refetch(),
  }));

  const variants = {
    device: {
      label: "Devices",
      query: trpc.tenant.members.devices.createQuery(() => ({
        tenantSlug: tenantSlug(),
      })),
    },
    user: {
      label: "Users",
      query: trpc.tenant.members.users.createQuery(() => ({
        tenantSlug: tenantSlug(),
      })),
    },
    group: {
      label: "Groups",
      query: trpc.tenant.members.groups.createQuery(() => ({
        tenantSlug: tenantSlug(),
      })),
    },
  };

  return (
    <PageLayout
      heading={
        <>
          <PageLayoutHeading>Scope</PageLayoutHeading>
          <AddMemberSheet
            variants={variants}
            onSubmit={(members) =>
              addMembers.mutateAsync({
                id: policy().id,
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
