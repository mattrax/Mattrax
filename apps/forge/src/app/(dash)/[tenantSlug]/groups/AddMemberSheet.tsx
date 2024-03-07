import { ParentProps, Suspense, createSignal } from "solid-js";
import { useQueryClient } from "@tanstack/solid-query";
import { z } from "zod";

import { Button, Tabs, TabsList, TabsTrigger } from "~/components/ui";
import { trpc } from "~/lib";
import { ConfirmDialog } from "~/components/ConfirmDialog";
import { StandardTable, createStandardTable } from "~/components/StandardTable";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
} from "~/components/ui/sheet";
import { columns } from "./[groupId]/index";
import { GroupAssignableVariant } from "~/db";
import { useZodParams } from "~/lib/useZodParams";
import { useTenantSlug } from "../../[tenantSlug]";

const AddMemberTableOptions = {
	all: "All",
	user: "Users",
	device: "Devices",
};

export function AddMemberSheet(props: ParentProps & { groupId: string }) {
	const [open, setOpen] = createSignal(false);

	const possibleMembers = trpc.group.possibleMembers.useQuery(
		() => ({ id: props.groupId }),
		() => ({ enabled: open() }),
	);

	const table = createStandardTable({
		get data() {
			return possibleMembers.data ?? [];
		},
		pagination: true,
		columns,
	});

	const addMembers = trpc.group.addMembers.useMutation(() => ({
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
										(table.getColumn("variant")?.getFilterValue() as
											| GroupAssignableVariant
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
