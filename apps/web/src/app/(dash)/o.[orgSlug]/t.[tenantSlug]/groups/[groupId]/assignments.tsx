import { withDependantQueries } from "@mattrax/trpc-server-function/client";
import { Badge, Button, SheetTrigger } from "@mattrax/ui";
import type { RouteDefinition } from "@solidjs/router";
import pluralize from "pluralize";
import { Match, Suspense, Switch } from "solid-js";

import { trpc } from "~/lib";
import { toTitleCase } from "~/lib/utils";
import { BulkDeleteDialog, createBulkDeleteDialog } from "~c/BulkDeleteDialog";
import { PageLayout, PageLayoutHeading } from "~c/PageLayout";
import {
	FloatingSelectionBar,
	StandardTable,
	createSearchParamFilter,
	createStandardTable,
} from "~c/StandardTable";
import { TableSearchParamsInput } from "~c/TableSearchParamsInput";
import {
	VariantTableSheet,
	createVariantTableColumns,
} from "~c/VariantTableSheet";
import { cacheMetadata } from "../../metadataCache";
import { useGroupId } from "../ctx";
import { createAssignmentsVariants } from "./utils";

export const route = {
	load: ({ params }) =>
		trpc.useContext().group.assignments.ensureData({ id: params.groupId! }),
} satisfies RouteDefinition;

function createAssignmentsQuery() {
	const groupId = useGroupId();

	const assignments = trpc.group.assignments.createQuery(() => ({
		id: groupId(),
	}));
	const cacheAssignmentsWithVariant = (v: "policy" | "application") =>
		cacheMetadata(
			v,
			() => assignments.data?.filter((a) => a.variant === v) ?? [],
		);

	cacheAssignmentsWithVariant("policy");
	cacheAssignmentsWithVariant("application");

	return assignments;
}

export default function Page() {
	const groupId = useGroupId();

	const assignments = createAssignmentsQuery();

	const variants = createAssignmentsVariants("../../../");

	const table = createStandardTable({
		get data() {
			return assignments.data ?? [];
		},
		columns: createVariantTableColumns(),
	});

	createSearchParamFilter(table, "name", "search");

	const addAssignments = trpc.group.addAssignments.createMutation(() => ({
		...withDependantQueries(assignments),
	}));

	const removeAssignments = trpc.group.removeAssignments.createMutation(() => ({
		// TODO: `withDependantQueries`???
		onSuccess: () => assignments.refetch(),
	}));

	const dialog = createBulkDeleteDialog({
		table,
		onDelete: (data) =>
			removeAssignments.mutateAsync({
				id: groupId(),
				assignments: data.map(({ pk, variant }) => ({
					pk,
					variant: variant as any,
				})),
			}),
	});

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
						<SheetTrigger as={Button} class="ml-auto">
							Add Assignments
						</SheetTrigger>
					</VariantTableSheet>
				</>
			}
		>
			<div class="flex flex-row items-center gap-4">
				<TableSearchParamsInput query={assignments} class="flex-1" />
			</div>
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
					title={() => "Remove From Group"}
					description={({ count, rows }) => (
						<>
							Are you sure you want to remove{" "}
							<Switch>
								<Match when={count() > 1}>
									{count()} {pluralize("member", count())}{" "}
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
							from this group?
						</>
					)}
				/>
			</Suspense>
		</PageLayout>
	);
}
