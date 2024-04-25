import { As, Dialog as DialogPrimitive } from "@kobalte/core";
import { Switch, Match, Suspense, createSignal } from "solid-js";
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
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@mattrax/ui";
import pluralize from "pluralize";

import { PageLayout, PageLayoutHeading } from "~c/PageLayout";
import { StandardTable, createStandardTable } from "~c/StandardTable";
import { VariantTableSheet, variantTableColumns } from "~c/VariantTableSheet";
import IconPhDotsThreeBold from "~icons/ph/dots-three-bold";
import { useTenantSlug } from "../../../t.[tenantSlug]";
import { usePolicyId } from "../[policyId]";
import { trpc } from "~/lib";
import { RouteDefinition } from "@solidjs/router";
import { toTitleCase } from "~/lib/utils";
import { inferProcedureOutput } from "@trpc/server";

export const route = {
	load: ({ params }) =>
		trpc.useContext().policy.assignees.ensureData({ id: params.policyId! }),
} satisfies RouteDefinition;

export default function Page() {
	const policyId = usePolicyId();

	const assignees = trpc.policy.assignees.createQuery(() => ({
		id: policyId(),
	}));

	const [dialog, setDialog] = createSignal<{
		open: boolean;
		data:
			| {
					type: "removeSingle";
					data: NonNullable<typeof assignees.data>[number];
			  }
			| { type: "removeMany"; data: NonNullable<typeof assignees.data> };
	}>({ open: false, data: { type: "removeMany", data: [] } });

	const table = createStandardTable({
		get data() {
			return assignees.data ?? [];
		},
		columns: [
			...variantTableColumns,
			{
				id: "actions",
				header: ({ table }) => {
					return (
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<As
									component={Button}
									variant="ghost"
									size="iconSmall"
									class="block"
								>
									<IconPhDotsThreeBold class="w-6 h-6" />
								</As>
							</DropdownMenuTrigger>
							<DropdownMenuContent>
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
									Unassign from Policy (
									{table.getSelectedRowModel().rows.length})
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
					);
				},
				cell: ({ row }) => (
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<As
								component={Button}
								variant="ghost"
								size="iconSmall"
								class="block"
							>
								<IconPhDotsThreeBold class="w-6 h-6" />
							</As>
						</DropdownMenuTrigger>
						<DropdownMenuContent>
							<DropdownMenuItem
								class="text-red-600"
								onSelect={() =>
									setDialog({
										open: true,
										data: { type: "removeSingle", data: row.original as any },
									})
								}
							>
								Unassign from Policy
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				),
				size: 1,
			},
		],
		pagination: true,
	});

	const addAssignees = trpc.policy.addAssignees.createMutation(() => ({
		onSuccess: () => assignees.refetch(),
	}));

	const variants = createVariants();

	const removeAssignees = trpc.policy.removeAssignees.createMutation(() => ({
		onSuccess: () =>
			assignees.refetch().then(() => {
				table.resetRowSelection(true);
				setDialog({ ...dialog(), open: false });
			}),
	}));

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
						<As component={Button} class="ml-auto">
							Assign Policy
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
								<DialogTitle>Unassign From Policy</DialogTitle>
								<DialogDescription>
									Are you sure you want to unassign{" "}
									{table.getSelectedRowModel().rows.length}{" "}
									{pluralize(
										"assignee",
										table.getSelectedRowModel().rows.length,
									)}{" "}
									from this policy?
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
										removeAssignees.mutateAsync({
											id: policyId(),
											assignees: table
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
										<DialogTitle>Unassign From Policy</DialogTitle>
										<DialogDescription>
											Are you sure you want to unassign{" "}
											<div class="inline text-nowrap">
												<span class="text-black font-medium">
													{data().name}
												</span>
												<Badge class="mx-1.5">
													{toTitleCase(data().variant)}
												</Badge>
											</div>
											from this policy?
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
												removeAssignees.mutateAsync({
													id: policyId(),
													assignees: [
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
			<Suspense>
				<StandardTable table={table} />
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
		},
		user: {
			label: "Users",
			query: trpc.tenant.variantTable.users.createQuery(() => ({
				tenantSlug: tenantSlug(),
			})),
		},
		group: {
			label: "Groups",
			query: trpc.tenant.variantTable.groups.createQuery(() => ({
				tenantSlug: tenantSlug(),
			})),
		},
	};
}
