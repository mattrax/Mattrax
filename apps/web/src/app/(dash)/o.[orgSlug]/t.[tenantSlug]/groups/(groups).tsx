import {
	AsyncButton,
	Button,
	DialogDescription,
	DialogFooter,
	DropdownMenuTrigger,
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@mattrax/ui";
import { A, type RouteDefinition, useNavigate } from "@solidjs/router";
import { createColumnHelper } from "@tanstack/solid-table";
import {
	Match,
	type ParentProps,
	Suspense,
	Switch,
	createSignal,
	startTransition,
} from "solid-js";
import { z } from "zod";

import type { RouterOutput } from "~/api/trpc";
import { trpc } from "~/lib";
import {
	ColumnsDropdown,
	FloatingSelectionBar,
	StandardTable,
	createSearchParamFilter,
	createStandardTable,
	selectCheckboxColumn,
} from "~c/StandardTable";
import IconCarbonCaretDown from "~icons/carbon/caret-down.jsx";

export const route = {
	load: ({ params }) => {
		trpc.useContext().group.list.ensureData({
			tenantSlug: params.tenantSlug!,
		});
	},
} satisfies RouteDefinition;

const column = createColumnHelper<RouterOutput["group"]["list"][number]>();

const columns = [
	selectCheckboxColumn,
	column.accessor("name", {
		header: "Name",
		cell: (props) => (
			<A
				class="font-medium hover:underline focus:underline p-1 -m-1 w-full block"
				href={props.row.original.id}
			>
				{props.getValue()}
			</A>
		),
	}),
	column.accessor("memberCount", {
		header: "Member Count",
	}),
];

// TODO: Disable search, filters and sort until all backend metadata has loaded in. Show tooltip so it's clear what's going on.

export default function Page() {
	const tenantSlug = useTenantSlug();

	const groups = trpc.group.list.createQuery(() => ({
		tenantSlug: tenantSlug(),
	}));
	cacheMetadata("group", () => groups.data ?? []);

	const table = createStandardTable({
		get data() {
			return groups.data ?? [];
		},
		columns,
	});

	createSearchParamFilter(table, "name", "search");

	const [dialog, setDialog] = createSignal<{
		open: boolean;
		data:
			| {
					type: "deleteSingle";
					data: NonNullable<typeof groups.data>[number];
			  }
			| { type: "deleteMany"; data: NonNullable<typeof groups.data> };
	}>({ open: false, data: { type: "deleteMany", data: [] } });

	const deleteGroups = trpc.group.delete.createMutation(() => ({
		onSuccess: () =>
			groups.refetch().then(() => {
				table.resetRowSelection(true);
				setDialog({ ...dialog(), open: false });
			}),
	}));

	return (
		<PageLayout
			heading={
				<>
					<PageLayoutHeading>Groups</PageLayoutHeading>
					<CreateGroupDialog>
						<PopoverTrigger as={Button} class="ml-auto">
							Create Group
						</PopoverTrigger>
					</CreateGroupDialog>
				</>
			}
		>
			<div class="flex items-center gap-4">
				<TableSearchParamsInput query={groups} />
				<ColumnsDropdown table={table}>
					<DropdownMenuTrigger
						as={Button}
						variant="outline"
						class="ml-auto select-none"
					>
						Columns
						<IconCarbonCaretDown class="ml-2 h-4 w-4" />
					</DropdownMenuTrigger>
				</ColumnsDropdown>
			</div>
			<Suspense>
				<StandardTable table={table} />
				<DialogRoot
					open={dialog().open}
					onOpenChange={(o) => {
						if (!o) setDialog({ ...dialog(), open: false });
					}}
				>
					<DialogContent>
						<DialogHeader>
							<DialogTitle>
								Delete{" "}
								{pluralize("Group", table.getSelectedRowModel().rows.length)}
							</DialogTitle>
							<DialogDescription>
								Are you sure you want to delete{" "}
								<Switch>
									<Match when={dialog().data?.type === "deleteMany"}>
										{table.getSelectedRowModel().rows.length}{" "}
										{pluralize(
											"group",
											table.getSelectedRowModel().rows.length,
										)}
									</Match>
									<Match
										when={(() => {
											const d = dialog();
											if (d.data?.type === "deleteSingle") return d.data.data;
										})()}
									>
										{(data) => (
											<div class="inline text-nowrap">
												<span class="text-black font-medium">
													{data().name}
												</span>
											</div>
										)}
									</Match>
								</Switch>
								?
							</DialogDescription>
						</DialogHeader>
						<DialogFooter>
							<Dialog.CloseButton as={Button} variant="secondary">
								Cancel
							</Dialog.CloseButton>
							<div class="flex-1" />
							<AsyncButton
								onClick={() => {
									const { data } = dialog();

									if (data.type === "deleteMany") {
										return deleteGroups.mutateAsync({
											tenantSlug: tenantSlug(),
											ids: data.data.map(({ id }) => id),
										});
									}

									return deleteGroups.mutateAsync({
										tenantSlug: tenantSlug(),
										ids: [data.data.id],
									});
								}}
								variant="destructive"
							>
								Confirm
							</AsyncButton>
						</DialogFooter>
					</DialogContent>
				</DialogRoot>
				<FloatingSelectionBar table={table}>
					{(rows) => {
						return (
							<Button
								variant="destructive"
								size="sm"
								onClick={() => {
									if (rows().length === 1)
										setDialog({
											open: true,
											data: {
												type: "deleteSingle",
												data: rows()[0]!.original as any,
											},
										});
									else
										setDialog({
											open: true,
											data: {
												type: "deleteMany",
												data: rows().map(({ original }) => original as any),
											},
										});
								}}
							>
								Delete
							</Button>
						);
					}}
				</FloatingSelectionBar>
			</Suspense>
		</PageLayout>
	);
}

import { Dialog } from "@kobalte/core/dialog";
import {
	DialogContent,
	DialogHeader,
	DialogRoot,
	DialogTitle,
} from "@mattrax/ui";
import { Form, InputField, createZodForm } from "@mattrax/ui/forms";
import pluralize from "pluralize";

import { TableSearchParamsInput } from "~/components/TableSearchParamsInput";
import { PageLayout, PageLayoutHeading } from "~c/PageLayout";
import { useTenantSlug } from "../ctx";
import { cacheMetadata } from "../metadataCache";

function CreateGroupDialog(props: ParentProps) {
	const tenantSlug = useTenantSlug();
	const navigate = useNavigate();

	const mutation = trpc.group.create.createMutation(() => ({
		onSuccess: async (groupId) => {
			await startTransition(() => navigate(groupId));
		},
	}));

	const form = createZodForm({
		schema: z.object({ name: z.string() }),
		onSubmit: ({ value }) =>
			mutation.mutateAsync({
				name: value.name,
				tenantSlug: tenantSlug(),
			}),
	});

	return (
		<Popover>
			{props.children}
			<PopoverContent class="p-4">
				<Form
					form={form}
					class="w-full"
					fieldsetClass="space-y-2 flex flex-col"
				>
					<InputField
						fieldProps={{ preserveValue: true }}
						type="text"
						form={form}
						name="name"
						placeholder="New Group"
						autocomplete="off"
					/>
					<Button type="submit">Create Group</Button>
				</Form>
			</PopoverContent>
		</Popover>
	);
}
