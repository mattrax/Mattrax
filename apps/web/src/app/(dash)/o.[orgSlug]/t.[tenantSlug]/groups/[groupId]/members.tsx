import { RouteDefinition, useSearchParams } from "@solidjs/router";
import { As } from "@kobalte/core";
import { Button } from "@mattrax/ui";
import pluralize from "pluralize";
import { Suspense, createEffect } from "solid-js";

import { trpc } from "~/lib";
import { PageLayout, PageLayoutHeading } from "~c/PageLayout";
import {
	StandardTable,
	createSearchParamFilter,
	createStandardTable,
} from "~c/StandardTable";
import { VariantTableSheet, variantTableColumns } from "~c/VariantTableSheet";
import { TableSearchParamsInput } from "~c/TableSearchParamsInput";
import { useTenantSlug } from "../../../t.[tenantSlug]";
import { useGroup } from "./Context";

export const route = {
	load: ({ params }) => {
		trpc.useContext().group.members.ensureData({
			id: params.groupId!,
		});
	},
} satisfies RouteDefinition;

export default function Page() {
	const group = useGroup();
	const tenantSlug = useTenantSlug();

	const members = trpc.group.members.createQuery(() => ({
		id: group().id,
	}));

	const table = createStandardTable({
		get data() {
			return members.data ?? [];
		},
		columns: variantTableColumns,
		// pagination: true, // TODO: Pagination
	});

	createSearchParamFilter(table, "name", "search");

	const addMembers = trpc.group.addMembers.createMutation(() => ({
		onSuccess: () => members.refetch(),
	}));

	const variants = {
		user: {
			label: "Users",
			query: trpc.tenant.variantTable.users.createQuery(() => ({
				tenantSlug: tenantSlug(),
			})),
		},
		device: {
			label: "Devices",
			query: trpc.tenant.variantTable.devices.createQuery(() => ({
				tenantSlug: tenantSlug(),
			})),
		},
	};

	return (
		<PageLayout
			heading={
				<>
					<PageLayoutHeading>Members</PageLayoutHeading>
					<VariantTableSheet
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
						<As component={Button} class="ml-auto">
							Add Members
						</As>
					</VariantTableSheet>
				</>
			}
		>
			<div class="flex flex-row items-center gap-4">
				<TableSearchParamsInput query={members} class="flex-1" />
			</div>
			<Suspense>
				<StandardTable table={table} />
			</Suspense>
		</PageLayout>
	);
}
