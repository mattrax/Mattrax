import { Button } from "@mattrax/ui";
import { Suspense } from "solid-js";
import { As } from "@kobalte/core";
import pluralize from "pluralize";

import { trpc } from "~/lib";
import { PageLayout, PageLayoutHeading } from "~c/PageLayout";
import {
	StandardTable,
	createSearchParamFilter,
	createStandardTable,
} from "~c/StandardTable";
import { VariantTableSheet, variantTableColumns } from "~c/VariantTableSheet";
import { useTenantSlug } from "../../../t.[tenantSlug]";
import { TableSearchParamsInput } from "~c/TableSearchParamsInput";
import { useGroupId } from "../[groupId]";
import { RouteDefinition } from "@solidjs/router";

export const route = {
	load: ({ params }) =>
		trpc.useContext().group.assignments.ensureData({ id: params.groupId! }),
} satisfies RouteDefinition;

export default function Page() {
	const tenantSlug = useTenantSlug();
	const groupId = useGroupId();

	const assignments = trpc.group.assignments.createQuery(() => ({
		id: groupId(),
	}));

	const table = createStandardTable({
		get data() {
			if (!assignments.data) return [];

			return [
				...assignments.data.policies.map((d) => ({ ...d, variant: "policy" })),
				...assignments.data.apps.map((d) => ({ ...d, variant: "application" })),
			];
		},
		columns: variantTableColumns,
		pagination: true,
	});

	createSearchParamFilter(table, "name", "search");

	const addAssignments = trpc.group.addAssignments.createMutation(() => ({
		onSuccess: () => assignments.refetch(),
	}));

	const variants = {
		policy: {
			label: "Policies",
			query: trpc.tenant.variantTable.policies.createQuery(() => ({
				tenantSlug: tenantSlug(),
			})),
		},
		application: {
			label: "Applications",
			query: trpc.tenant.variantTable.apps.createQuery(() => ({
				tenantSlug: tenantSlug(),
			})),
		},
	};

	return (
		<PageLayout
			heading={
				<>
					<PageLayoutHeading>Assignments</PageLayoutHeading>
					<VariantTableSheet
						title="Add Assigments"
						description="Assign policies and apps to this group."
						getSubmitText={(count) =>
							`Add ${count} ${pluralize("Assignment", count)}`
						}
						variants={variants}
						onSubmit={(assignments) =>
							addAssignments.mutateAsync({ id: groupId(), assignments })
						}
					>
						<As component={Button} class="ml-auto">
							Add Assignments
						</As>
					</VariantTableSheet>
				</>
			}
		>
			<div class="flex flex-row items-center gap-4">
				<TableSearchParamsInput query={assignments} class="flex-1" />
			</div>
			<Suspense>
				<StandardTable table={table} />
			</Suspense>
		</PageLayout>
	);
}
