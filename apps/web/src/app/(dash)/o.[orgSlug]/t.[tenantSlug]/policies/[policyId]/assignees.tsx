import { Dialog } from "@kobalte/core";
import { withDependantQueries } from "@mattrax/trpc-server-function/client";
import {
	AsyncButton,
	Badge,
	Button,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogRoot,
	DialogTitle,
	SheetTrigger,
} from "@mattrax/ui";
import type { RouteDefinition } from "@solidjs/router";
import type { Table } from "@tanstack/solid-table";
import pluralize from "pluralize";
import { Match, Suspense, Switch, createSignal } from "solid-js";

import {
	BulkDeleteDialog,
	createBulkDeleteDialog,
} from "~/components/BulkDeleteDialog";
import { trpc } from "~/lib";
import { toTitleCase } from "~/lib/utils";
import { PageLayout, PageLayoutHeading } from "~c/PageLayout";
import {
	FloatingSelectionBar,
	StandardTable,
	createStandardTable,
} from "~c/StandardTable";
import {
	VariantTableSheet,
	type VariantTableVariants,
	createVariantTableColumns,
} from "~c/VariantTableSheet";
import { useTenantSlug } from "../../ctx";
import { usePolicyId } from "../ctx";

export const route = {
	load: ({ params }) =>
		trpc.useContext().policy.assignees.ensureData({ id: params.policyId! }),
} satisfies RouteDefinition;

function createAssigneesQuery() {
	const policyId = usePolicyId();

	const assignees = trpc.policy.assignees.createQuery(() => ({
		id: policyId(),
	}));

	return assignees;
}
export default function Page() {
	const policyId = usePolicyId();

	const assignees = createAssigneesQuery();

	const variants = createVariants();
	const table = createStandardTable({
		get data() {
			return assignees.data ?? [];
		},
		columns: createVariantTableColumns(),
	});

	const addAssignees = trpc.policy.addAssignees.createMutation(() => ({
		...withDependantQueries(assignees),
	}));

	const removeAssignees = trpc.policy.removeAssignees.createMutation(() => ({
		// TODO: `withDependantQueries`
		onSuccess: () => assignees.refetch(),
	}));

	const dialog = createBulkDeleteDialog({
		table,
		onDelete: (data) =>
			removeAssignees.mutateAsync({
				id: policyId(),
				assignees: data.map(({ pk, variant }) => ({
					pk,
					variant: variant as any,
				})),
			}),
	});

	return (
		<PageLayout
			heading={
				<>
					<PageLayoutHeading>Assignees</PageLayoutHeading>
					<VariantTableSheet
						title="Assign Policy"
						description="Assign this policy to devices, users, and groups."
						getSubmitText={(count) =>
							`Add ${count} ${pluralize("Assignee", count)}`
						}
						variants={variants}
						onSubmit={(members) =>
							addAssignees.mutateAsync({
								id: policyId(),
								assignees: members,
							})
						}
					>
						<SheetTrigger as={Button} class="ml-auto">
							Assign Policy
						</SheetTrigger>
					</VariantTableSheet>
				</>
			}
		>
			<Suspense>
				<StandardTable table={table} />
				<FloatingSelectionBar table={table}>
					{(rows) => (
						<Button
							variant="destructive"
							size="sm"
							onClick={() => dialog.show(rows())}
						>
							Delete
						</Button>
					)}
				</FloatingSelectionBar>
				<BulkDeleteDialog
					dialog={dialog}
					title={({ count }) => <>Delete {pluralize("Group", count())}</>}
					description={({ count, rows }) => (
						<>
							Are you sure you want to unassign{" "}
							<Switch>
								<Match when={count() > 1}>
									{count()} {pluralize("assignee", count())}
								</Match>
								<Match when={rows()[0]}>
									{(data) => (
										<div class="inline text-nowrap">
											<span class="text-black font-medium">
												{data().original.name}
											</span>
											<Badge class="mx-1.5">
												{toTitleCase(data().original.variant)}
											</Badge>
										</div>
									)}
								</Match>
							</Switch>
							from this policy?
						</>
					)}
				/>
			</Suspense>
		</PageLayout>
	);
}

function createVariants() {
	const tenantSlug = useTenantSlug();

	return {
		device: {
			label: "Devices",
			query: trpc.tenant.variantTable.devices.createQuery(() => ({
				tenantSlug: tenantSlug(),
			})),
			href: (item) => `../../../devices/${item.id}`,
		},
		user: {
			label: "Users",
			query: trpc.tenant.variantTable.users.createQuery(() => ({
				tenantSlug: tenantSlug(),
			})),
			href: (item) => `../../../users/${item.id}`,
		},
		group: {
			label: "Groups",
			query: trpc.tenant.variantTable.groups.createQuery(() => ({
				tenantSlug: tenantSlug(),
			})),
			href: (item) => `../../../groups/${item.id}`,
		},
	} satisfies VariantTableVariants;
}
