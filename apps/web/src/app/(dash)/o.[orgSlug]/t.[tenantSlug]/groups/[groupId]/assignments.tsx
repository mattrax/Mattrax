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
	DropdownMenuItem,
	SheetTrigger,
} from "@mattrax/ui";
import pluralize from "pluralize";
import { Match, Suspense, Switch, createSignal } from "solid-js";

import { Dialog } from "@kobalte/core";
import { withDependantQueries } from "@mattrax/trpc-server-function/client";
import type { RouteDefinition } from "@solidjs/router";
import { trpc } from "~/lib";
import { toTitleCase } from "~/lib/utils";
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

export default function Page() {
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

	const [dialog, setDialog] = createSignal<{
		open: boolean;
		data:
			| {
					type: "removeSingle";
					data: NonNullable<typeof assignments.data>[number];
			  }
			| { type: "removeMany"; data: NonNullable<typeof assignments.data> };
	}>({ open: false, data: { type: "removeMany", data: [] } });

	const variants = createAssignmentsVariants("../../../");

	const table = createStandardTable({
		get data() {
			return assignments.data ?? [];
		},
		columns: createVariantTableColumns(variants),
	});

	createSearchParamFilter(table, "name", "search");

	const addAssignments = trpc.group.addAssignments.createMutation(() => ({
		...withDependantQueries(assignments),
	}));

	const removeAssignments = trpc.group.removeAssignments.createMutation(() => ({
		// TODO: `withDependantQueries`???
		onSuccess: () =>
			assignments.refetch().then(() => {
				table.resetRowSelection(true);
				setDialog({ ...dialog(), open: false });
			}),
	}));

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
			<DialogRoot
				open={dialog().open}
				onOpenChange={(o) => {
					if (!o) setDialog({ ...dialog(), open: false });
				}}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Remove From Group</DialogTitle>
						<DialogDescription>
							Are you sure you want to remove{" "}
							<Switch>
								<Match when={dialog().data?.type === "removeMany"}>
									{table.getSelectedRowModel().rows.length}{" "}
									{pluralize(
										"member",
										table.getSelectedRowModel().rows.length,
									)}{" "}
								</Match>
								<Match
									when={(() => {
										const d = dialog();
										if (d.data?.type === "removeSingle") return d.data.data;
									})()}
								>
									{(data) => (
										<div class="inline text-nowrap">
											<span class="text-black font-medium">{data().name}</span>
											<Badge class="mx-1.5">
												{toTitleCase(data().variant)}
											</Badge>
										</div>
									)}
								</Match>
							</Switch>
							from this group?
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Dialog.CloseButton as={Button} variant="secondary">
							Cancel
						</Dialog.CloseButton>
						<div class="flex-1" />
						<AsyncButton
							variant="destructive"
							onClick={() => {
								const { data } = dialog();

								if (data.type === "removeSingle")
									return removeAssignments.mutateAsync({
										id: groupId(),
										assignments: [
											{ pk: data.data.pk, variant: data.data.variant },
										],
									});

								return removeAssignments.mutateAsync({
									id: groupId(),
									assignments: data.data.map(({ pk, variant }) => ({
										pk,
										variant,
									})),
								});
							}}
						>
							Confirm
						</AsyncButton>
					</DialogFooter>
				</DialogContent>
			</DialogRoot>
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
							onClick={() => {
								if (rows().length === 1)
									setDialog({
										open: true,
										data: {
											type: "removeSingle",
											data: rows()[0]!.original as any,
										},
									});
								else
									setDialog({
										open: true,
										data: {
											type: "removeMany",
											data: rows().map(({ original }) => original as any),
										},
									});
							}}
						>
							Unassign from Group
						</Button>
					)}
				</FloatingSelectionBar>
			</Suspense>
		</PageLayout>
	);
}
