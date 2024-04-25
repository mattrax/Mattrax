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
} from "@mattrax/ui";
import { Match, Suspense, Switch, createSignal } from "solid-js";
import { As, Dialog as DialogPrimitive } from "@kobalte/core";
import pluralize from "pluralize";

import { trpc } from "~/lib";
import { PageLayout, PageLayoutHeading } from "~c/PageLayout";
import {
	StandardTable,
	createActionsColumn,
	createSearchParamFilter,
	createStandardTable,
} from "~c/StandardTable";
import {
	VariantTableSheet,
	createVariantTableColumns,
} from "~c/VariantTableSheet";
import { TableSearchParamsInput } from "~c/TableSearchParamsInput";
import { useGroupId } from "../[groupId]";
import { RouteDefinition } from "@solidjs/router";
import { toTitleCase } from "~/lib/utils";
import { createAssignmentsVariants } from "./utils";
import { cacheMetadata } from "../../metadataCache";

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
		onSuccess: () => assignments.refetch(),
	}));

	const removeAssignments = trpc.group.removeAssignments.createMutation(() => ({
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
						<As component={Button} class="ml-auto">
							Add Assignments
						</As>
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
								<DialogPrimitive.CloseButton asChild>
									<As component={Button} variant="secondary">
										Cancel
									</As>
								</DialogPrimitive.CloseButton>
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
										<DialogPrimitive.CloseButton asChild>
											<As component={Button} variant="secondary">
												Cancel
											</As>
										</DialogPrimitive.CloseButton>
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
