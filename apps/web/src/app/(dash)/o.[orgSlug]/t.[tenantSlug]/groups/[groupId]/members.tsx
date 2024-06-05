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
import pluralize from "pluralize";
import { Match, Suspense, Switch, createSignal } from "solid-js";

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
import { createMembersVariants } from "./utils";

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
		columns: createVariantTableColumns(variants),
	});

	createSearchParamFilter(table, "name", "search");

	const addMembers = trpc.group.addMembers.createMutation(() => ({
		...withDependantQueries(members),
	}));

	const removeMembers = trpc.group.removeMembers.createMutation(() => ({
		// TODO: `withDependantQueries`
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
						<SheetTrigger as={Button} class="ml-auto">
							Add Members
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
									{pluralize("member", table.getSelectedRowModel().rows.length)}
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
							</Switch>{" "}
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
									return removeMembers.mutateAsync({
										id: groupId(),
										members: [{ pk: data.data.pk, variant: data.data.variant }],
									});

								return removeMembers.mutateAsync({
									id: groupId(),
									members: data.data.map(({ pk, variant }) => ({
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
				<TableSearchParamsInput query={members} class="flex-1" />
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
							Remove from Group
						</Button>
					)}
				</FloatingSelectionBar>
			</Suspense>
		</PageLayout>
	);
}
