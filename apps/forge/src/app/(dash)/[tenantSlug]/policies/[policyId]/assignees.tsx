// TODO: Deduplicate this UI stuff with the groups page
// TODO: cause it's the same thing with some tRPC queries switched out.

import { As } from "@kobalte/core";
import {
	Accessor,
	For,
	ParentProps,
	Show,
	Suspense,
	createSignal,
} from "solid-js";
import { z } from "zod";

import { Button, Tabs, TabsList, TabsTrigger } from "~/components/ui";
import { trpc } from "~/lib";
import { useZodParams } from "~/lib/useZodParams";

export default function Page() {
	const routeParams = useZodParams({ policyId: z.string() });

	const tenant = useTenant();
	const policy = usePolicy();

	console.log(routeParams.policyId, tenant().id); // TODO

	const group = trpc.policy.scope.useQuery(
		() => ({ id: policy().id, tenantSlug: tenant().slug }),
		() => ({ enabled: true }),
	);

	return (
		<PageLayout
			heading={
				<>
					<PageLayoutHeading>Assignees</PageLayoutHeading>
					<AddMemberSheet groupId={routeParams.policyId}>
						<As component={Button} class="ml-auto">
							Add Assignee
						</As>
					</AddMemberSheet>
				</>
			}
		>
			<Show when={group.data}>
				{(group) => {
					const table = createMembersTable(() => group().id);

					return (
						<Suspense>
							<StandardTable table={table} />
						</Suspense>
					);
				}}
			</Show>
		</PageLayout>
	);
}

import { createColumnHelper } from "@tanstack/solid-table";

const VariantDisplay = {
	user: "User",
	device: "Device",
	group: "Group",
} as const;

type Variant = keyof typeof VariantDisplay;

const columnHelper = createColumnHelper<{
	pk: number;
	// id: string;
	name: string;
	variant: Variant;
}>();

const columns = [
	selectCheckboxColumn,
	columnHelper.accessor("name", { header: "Name" }),
	columnHelper.accessor("variant", {
		header: "Variant",
		cell: (info) => <Badge>{VariantDisplay[info.getValue()]}</Badge>,
	}),
];

function createMembersTable(groupId: Accessor<string>) {
	const tenant = useTenant();
	// TODO: Fix this
	const members = trpc.policy.members.useQuery(() => ({
		id: groupId(),
		tenantSlug: tenant().slug,
	}));

	return createStandardTable({
		get data() {
			return members.data ?? [];
		},
		columns,
		pagination: true,
	});
}

import { useQueryClient } from "@tanstack/solid-query";
import { useTenant } from "~/app/(dash)/[tenantSlug]";
import { ConfirmDialog } from "~/components/ConfirmDialog";
import {
	StandardTable,
	createStandardTable,
	selectCheckboxColumn,
} from "~/components/StandardTable";
import { Badge } from "~/components/ui/badge";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
} from "~/components/ui/sheet";
import { PageLayout, PageLayoutHeading } from "../../PageLayout";
import { usePolicy } from "../[policyId]";

const AddMemberTableOptions = {
	all: "All",
	user: "Users",
	device: "Devices",
	group: "Groups",
};

function AddMemberSheet(props: ParentProps & { groupId: string }) {
	const [open, setOpen] = createSignal(false);

	const tenant = useTenant();
	// TODO
	const possibleMembers = trpc.policy.possibleMembers.useQuery(
		() => ({ id: props.groupId, tenantSlug: tenant().slug }),
		() => ({ enabled: open() }),
	);

	const table = createStandardTable({
		get data() {
			return possibleMembers.data ?? [];
		},
		columns,
	});

	const addMembers = trpc.policy.addMembers.useMutation(() => ({
		onSuccess: () => {
			setOpen(false);
		},
	}));

	const queryClient = useQueryClient();

	return (
		<ConfirmDialog>
			{(confirm) => (
				<Sheet
					open={open()}
					onOpenChange={async (o) => {
						if (o) table.resetRowSelection(true);

						if (
							o === false &&
							table.getIsSomeRowsSelected() &&
							!(await confirm({
								title: "Are You Sure?",
								description: "You still have members selected",
								action: "Continue",
							}))
						)
							return;

						setOpen(o);
					}}
				>
					<SheetTrigger asChild>{props.children}</SheetTrigger>
					<SheetContent
						transparent
						size="lg"
						class="overflow-y-auto flex flex-col"
					>
						<SheetHeader>
							<SheetTitle>Add Member</SheetTitle>
							<SheetDescription>
								Add users, devices, and policies to this group
							</SheetDescription>
						</SheetHeader>
						<Suspense>
							<div class="flex flex-row justify-between w-full items-center">
								<Tabs
									value={
										(table.getColumn("variant")!.getFilterValue() as
											| Variant
											| undefined) ?? "all"
									}
									onChange={(t) =>
										table
											.getColumn("variant")!
											.setFilterValue(t === "all" ? undefined : t)
									}
								>
									<TabsList>
										{Object.entries(AddMemberTableOptions).map(
											([value, name]) => (
												<TabsTrigger value={value}>{name}</TabsTrigger>
											),
										)}
									</TabsList>
								</Tabs>
								<Button
									disabled={
										!table.getSelectedRowModel().rows.length ||
										addMembers.isPending
									}
									onClick={async () => {
										await addMembers.mutateAsync({
											id: props.groupId,
											tenantSlug: tenant().slug,
											members: table.getSelectedRowModel().rows.map((row) => ({
												pk: row.original.pk,
												variant: row.original.variant,
											})),
										});

										setOpen(false);
										queryClient.invalidateQueries();
									}}
								>
									Add {table.getSelectedRowModel().rows.length} Member
									{table.getSelectedRowModel().rows.length !== 1 && "s"}
								</Button>
							</div>
							<StandardTable table={table} />
						</Suspense>
					</SheetContent>
				</Sheet>
			)}
		</ConfirmDialog>
	);
}
