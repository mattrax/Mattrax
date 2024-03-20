import { As } from "@kobalte/core";
import { A, type RouteDefinition, useNavigate } from "@solidjs/router";
import { createColumnHelper } from "@tanstack/solid-table";
import {
	type ParentProps,
	Suspense,
	startTransition,
	createEffect,
} from "solid-js";
import { z } from "zod";

import IconCarbonCaretDown from "~icons/carbon/caret-down.jsx";
import { trpc, untrackScopeFromSuspense } from "~/lib";

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

import type { RouterOutput } from "~/api/trpc";
import {
	ColumnsDropdown,
	StandardTable,
	createStandardTable,
	createSearchParamPagination,
	selectCheckboxColumn,
} from "~/components/StandardTable";
import { Button } from "@mattrax/ui";

function createGroupsTable() {
	const params = useZodParams({ tenantSlug: z.string() });
	const groups = trpc.group.list.useQuery(() => params);

	const table = createStandardTable({
		get data() {
			return groups.data ?? [];
		},
		columns,
		pagination: true,
	});

	createSearchParamPagination(table, "page");

	return { groups, table };
}

// TODO: Disable search, filters and sort until all backend metadata has loaded in. Show tooltip so it's clear what's going on.

export default function Page() {
	const { table, groups } = createGroupsTable();

	return (
		<PageLayout
			heading={
				<>
					<PageLayoutHeading>Groups</PageLayoutHeading>
					<CreateGroupDialog>
						<As component={Button} class="ml-auto">
							Create New Group
						</As>
					</CreateGroupDialog>
				</>
			}
		>
			<div class="flex items-center gap-4">
				<Input
					placeholder={!groups.latest ? "Loading..." : "Search..."}
					disabled={!groups.latest}
					value={(table.getColumn("name")?.getFilterValue() as string) ?? ""}
					onInput={(event) =>
						table.getColumn("name")?.setFilterValue(event.target.value)
					}
				/>
				<ColumnsDropdown table={table}>
					<As component={Button} variant="outline" class="ml-auto select-none">
						Columns
						<IconCarbonCaretDown class="ml-2 h-4 w-4" />
					</As>
				</ColumnsDropdown>
			</div>
			<Suspense>
				<StandardTable table={table} />
			</Suspense>
		</PageLayout>
	);
}

import {
	DialogContent,
	DialogHeader,
	DialogRoot,
	DialogTitle,
	DialogTrigger,
	Input,
} from "@mattrax/ui";
import { Form, InputField, createZodForm } from "@mattrax/ui/forms";
import { PageLayout, PageLayoutHeading } from "../PageLayout";
import { useZodParams } from "~/lib/useZodParams";

function CreateGroupDialog(props: ParentProps) {
	const params = useZodParams({ tenantSlug: z.string() });
	const navigate = useNavigate();

	const mutation = trpc.group.create.useMutation(() => ({
		onSuccess: async (groupId) => {
			await startTransition(() => navigate(groupId));
		},
	}));

	const form = createZodForm({
		schema: z.object({ name: z.string() }),
		onSubmit: ({ value }) =>
			mutation.mutateAsync({
				name: value.name,
				...params,
			}),
	});

	return (
		<DialogRoot>
			<DialogTrigger asChild>{props.children}</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Create Group</DialogTitle>
				</DialogHeader>
				<Form form={form} fieldsetClass="space-y-4 flex flex-col">
					<InputField
						form={form}
						label="Group Name"
						type="text"
						name="name"
						placeholder="New Group"
						autocomplete="off"
					/>
					<Button type="submit">Create Group</Button>
				</Form>
			</DialogContent>
		</DialogRoot>
	);
}
