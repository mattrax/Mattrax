import { Button, Popover, PopoverContent, PopoverTrigger } from "@mattrax/ui";
import { A, type RouteDefinition, useNavigate } from "@solidjs/router";
import { createColumnHelper } from "@tanstack/solid-table";
import {
	Match,
	type ParentProps,
	Suspense,
	Switch,
	startTransition,
} from "solid-js";
import { z } from "zod";

import type { RouterOutput } from "~/api/trpc";
import { trpc } from "~/lib";
import {
	FloatingSelectionBar,
	StandardTable,
	createSearchParamFilter,
	createStandardTable,
	selectCheckboxColumn,
} from "~c/StandardTable";

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

	const deleteGroups = trpc.group.delete.createMutation(() => ({
		onSuccess: () => groups.refetch(),
	}));

	const dialog = createBulkDeleteDialog({
		table,
		onDelete: (data) =>
			deleteGroups.mutateAsync({
				tenantSlug: tenantSlug(),
				ids: data.map(({ id }) => id),
			}),
	});

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
					title={({ count }) => <>Delete {pluralize("Group", count())}</>}
					description={({ count, rows }) => (
						<>
							Are you sure you want to delete{" "}
							<Switch>
								<Match when={count() > 1}>
									{count()} {pluralize("group", count())}
								</Match>
								<Match when={rows()[0]}>
									{(data) => (
										<div class="inline text-nowrap">
											<span class="text-black font-medium">
												{data().original.name}
											</span>
										</div>
									)}
								</Match>
							</Switch>
							?
						</>
					)}
				/>
			</Suspense>
		</PageLayout>
	);
}

import { Form, InputField, createZodForm } from "@mattrax/ui/forms/legacy";
import pluralize from "pluralize";

import { BulkDeleteDialog, createBulkDeleteDialog } from "~c/BulkDeleteDialog";
import { PageLayout, PageLayoutHeading } from "~c/PageLayout";
import { TableSearchParamsInput } from "~c/TableSearchParamsInput";
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

	const form = createZodForm(() => ({
		schema: z.object({ name: z.string() }),
		onSubmit: ({ value }) =>
			mutation.mutateAsync({
				name: value.name,
				tenantSlug: tenantSlug(),
			}),
	}));

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
