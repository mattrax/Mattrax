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
	StandardTable,
	createActionsColumn,
	createSearchParamFilter,
	createStandardTable,
} from "~c/StandardTable";
import { TableSearchParamsInput } from "~c/TableSearchParamsInput";
import {
	VariantTableSheet,
	createVariantTableColumns,
} from "~c/VariantTableSheet";
import { cacheMetadata } from "../../metadataCache";
import { useGroupId } from "../[groupId]";
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
		columns: [
			...createVariantTableColumns(variants),
			createActionsColumn({
				headerDropdownContent: ({ table }) => (
					<DropdownMenuItem
						disabled={table.getSelectedRowModel().rows.length === 0}
						class="text-red-600 data-[disabled]:text-black"
						onSelect={() =>
							setDialog({
								open: true,
								data: {
									type: "removeMany",
									data: table
										.getSelectedRowModel()
										.rows.map(({ original }) => original as any),
								},
							})
						}
					>
						Unassign from Group ({table.getSelectedRowModel().rows.length})
					</DropdownMenuItem>
				),
				cellDropdownContent: ({ row }) => (
					<DropdownMenuItem
						class="text-red-600"
						onSelect={() =>
							setDialog({
								open: true,
								data: { type: "removeSingle", data: row.original as any },
							})
						}
					>
						Unassign from Group
					</DropdownMenuItem>
				),
			}),
		],
		pagination: true,
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
					<Switch>
						<Match when={dialog().data?.type === "removeMany"}>
							<DialogHeader>
								<DialogTitle>Remove From Group</DialogTitle>
								<DialogDescription>
									Are you sure you want to remove{" "}
									{table.getSelectedRowModel().rows.length}{" "}
									{pluralize("member", table.getSelectedRowModel().rows.length)}{" "}
									from this group?
								</DialogDescription>
							</DialogHeader>
							<DialogFooter>
								<Dialog.CloseButton as={Button} variant="secondary">
									Cancel
								</Dialog.CloseButton>
								<div class="flex-1" />
								<AsyncButton
									onClick={() =>
										removeAssignments.mutateAsync({
											id: groupId(),
											assignments: table
												.getSelectedRowModel()
												.rows.map(({ original }) => ({
													pk: original.pk,
													variant: original.variant as any,
												})),
										})
									}
									variant="destructive"
								>
									Confirm
								</AsyncButton>
							</DialogFooter>
						</Match>
						<Match
							when={(() => {
								const d = dialog();
								if (d.data?.type === "removeSingle") return d.data.data;
							})()}
						>
							{(data) => (
								<>
									<DialogHeader>
										<DialogTitle>Remove From Group</DialogTitle>
										<DialogDescription>
											Are you sure you want to remove{" "}
											<div class="inline text-nowrap">
												<span class="text-black font-medium">
													{data().name}
												</span>
												<Badge class="mx-1.5">
													{toTitleCase(data().variant)}
												</Badge>
											</div>
											from this group?
										</DialogDescription>
									</DialogHeader>
									<DialogFooter>
										<Dialog.CloseButton as={Button} variant="secondary">
											Cancel
										</Dialog.CloseButton>
										<div class="flex-1" />
										<AsyncButton
											onClick={() =>
												removeAssignments.mutateAsync({
													id: groupId(),
													assignments: [
														{ pk: data().pk, variant: data().variant as any },
													],
												})
											}
											variant="destructive"
										>
											Confirm
										</AsyncButton>
									</DialogFooter>
								</>
							)}
						</Match>
					</Switch>
				</DialogContent>
			</DialogRoot>
			<div class="flex flex-row items-center gap-4">
				<TableSearchParamsInput query={assignments} class="flex-1" />
			</div>
			<Suspense>
				<StandardTable table={table} />
			</Suspense>
		</PageLayout>
	);
}
