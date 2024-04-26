import { As, Dialog as DialogPrimitive } from "@kobalte/core";
import { RouteDefinition } from "@solidjs/router";
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
import pluralize from "pluralize";
import { Match, Suspense, Switch, createSignal } from "solid-js";

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
import { toTitleCase } from "~/lib/utils";
import { createMembersVariants } from "./utils";
import { cacheMetadata } from "../../metadataCache";

export const route = {
	load: ({ params }) =>
		trpc.useContext().group.members.ensureData({
			id: params.groupId!,
		}),
} satisfies RouteDefinition;

export default function Page() {
	const groupId = useGroupId();

	const members = trpc.group.members.createQuery(() => ({ id: groupId() }));
	const cacheMembersWithVariant = (v: "user" | "device") =>
		cacheMetadata(v, () => members.data?.filter((a) => a.variant === v) ?? []);

	cacheMembersWithVariant("user");
	cacheMembersWithVariant("device");

	const [dialog, setDialog] = createSignal<{
		open: boolean;
		data:
			| {
					type: "removeSingle";
					data: NonNullable<typeof members.data>[number];
			  }
			| { type: "removeMany"; data: NonNullable<typeof members.data> };
	}>({ open: false, data: { type: "removeMany", data: [] } });

	const variants = createMembersVariants("../../../");

	const table = createStandardTable({
		get data() {
			return members.data ?? [];
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
						Remove from Group ({table.getSelectedRowModel().rows.length})
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
						Remove from Group
					</DropdownMenuItem>
				),
			}),
		],
		// pagination: true, // TODO: Pagination
	});

	createSearchParamFilter(table, "name", "search");

	const addMembers = trpc.group.addMembers.createMutation(() => ({
		onSuccess: () => members.refetch(),
	}));

	const removeMembers = trpc.group.removeMembers.createMutation(() => ({
		onSuccess: () =>
			members.refetch().then(() => {
				table.resetRowSelection(true);
				setDialog({ ...dialog(), open: false });
			}),
	}));

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
							addMembers.mutateAsync({ id: groupId(), members })
						}
					>
						<As component={Button} class="ml-auto">
							Add Members
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
										removeMembers.mutateAsync({
											id: groupId(),
											members: table
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
												removeMembers.mutateAsync({
													id: groupId(),
													members: [
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
				<TableSearchParamsInput query={members} class="flex-1" />
			</div>
			<Suspense>
				<StandardTable table={table} />
			</Suspense>
		</PageLayout>
	);
}