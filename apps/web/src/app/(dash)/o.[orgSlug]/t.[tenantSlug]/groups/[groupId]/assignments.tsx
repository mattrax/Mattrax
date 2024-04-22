import { As } from "@kobalte/core";
import { Suspense, createEffect } from "solid-js";
import { Button, Input } from "@mattrax/ui";
import pluralize from "pluralize";

import { trpc } from "~/lib";
import { useGroup } from "./Context";
import { PageLayout, PageLayoutHeading } from "~c/PageLayout";
import {
	StandardTable,
	createSearchParamFilter,
	createStandardTable,
} from "~c/StandardTable";
import { VariantTableSheet, variantTableColumns } from "~c/VariantTableSheet";
import { useTenantSlug } from "../../../t.[tenantSlug]";
import { TableSearchParamsInput } from "~c/TableSearchParamsInput";
import { useSearchParams } from "@solidjs/router";

export default function Page() {
	const group = useGroup();
	const tenantSlug = useTenantSlug();

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
							addAssignments.mutateAsync({
								id: group().id,
								assignments,
							})
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
