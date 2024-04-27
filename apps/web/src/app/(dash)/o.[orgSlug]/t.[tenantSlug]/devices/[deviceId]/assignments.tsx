import { As } from "@kobalte/core";
import { Suspense } from "solid-js";
import { Button } from "@mattrax/ui";
import pluralize from "pluralize";

import { trpc } from "~/lib";
import { useDevice } from "./Context";
import { PageLayout, PageLayoutHeading } from "~c/PageLayout";
import { StandardTable, createStandardTable } from "~c/StandardTable";
import {
	VariantTableSheet,
	createVariantTableColumns,
} from "~c/VariantTableSheet";
import { useTenantSlug } from "../../../t.[tenantSlug]";
import { RouteDefinition } from "@solidjs/router";

export const route = {
	load: ({ params }) => {
		trpc.useContext().device.assignments.ensureData({ id: params.userId! });
	},
} satisfies RouteDefinition;

export default function Page() {
	const tenantSlug = useTenantSlug();
	const device = useDevice();

	const assignments = trpc.device.assignments.createQuery(() => ({
		id: device().id,
	}));

	const table = createStandardTable({
		get data() {
			if (!assignments.data) return [];

			return [
				...assignments.data.policies.map((d) => ({ ...d, variant: "policy" })),
				...assignments.data.apps.map((d) => ({ ...d, variant: "application" })),
			];
		},
		columns: createVariantTableColumns(),
		pagination: true,
	});

	const addAssignments = trpc.device.addAssignments.createMutation(() => ({
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
						title="Add Assignments"
						description="Assign policies and apps to this device."
						getSubmitText={(count) =>
							`Add ${count} ${pluralize("Assignment", count)}`
						}
						variants={variants}
						onSubmit={(assignments) =>
							addAssignments.mutateAsync({
								id: device().id,
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
			<Suspense>
				<StandardTable table={table} />
			</Suspense>
		</PageLayout>
	);
}
