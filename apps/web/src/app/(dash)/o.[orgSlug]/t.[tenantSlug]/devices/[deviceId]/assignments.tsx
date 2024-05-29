import { Button, SheetTrigger } from "@mattrax/ui";
import pluralize from "pluralize";
import { Suspense } from "solid-js";

import type { RouteDefinition } from "@solidjs/router";
import { trpc } from "~/lib";
import { PageLayout, PageLayoutHeading } from "~c/PageLayout";
import { StandardTable, createStandardTable } from "~c/StandardTable";
import {
	VariantTableSheet,
	createVariantTableColumns,
} from "~c/VariantTableSheet";
import { useTenantSlug } from "../../ctx";
import { useDeviceId } from "../ctx";

export const route = {
	load: ({ params }) => {
		trpc.useContext().device.assignments.ensureData({ id: params.userId! });
	},
} satisfies RouteDefinition;

export default function Page() {
	const tenantSlug = useTenantSlug();
	const deviceId = useDeviceId();

	const assignments = trpc.device.assignments.createQuery(() => ({
		id: deviceId(),
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
								id: deviceId(),
								assignments,
							})
						}
					>
						<SheetTrigger as={Button} class="ml-auto">
							Add Assignments
						</SheetTrigger>
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
