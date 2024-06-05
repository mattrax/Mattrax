import { A, type RouteDefinition, useNavigate } from "@solidjs/router";
import { createColumnHelper } from "@tanstack/solid-table";
import { type ParentProps, Suspense, startTransition } from "solid-js";
import { z } from "zod";

import { trpc } from "~/lib";
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

import { Button, DropdownMenuTrigger } from "@mattrax/ui";
import type { RouterOutput } from "~/api/trpc";
import {
	ColumnsDropdown,
	StandardTable,
	createSearchParamFilter,
	// createSearchParamPagination,
	createStandardTable,
	selectCheckboxColumn,
} from "~c/StandardTable";

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

	// createSearchParamPagination(table, "page");
	createSearchParamFilter(table, "name", "search");

	return (
		<PageLayout
			heading={
				<>
					<PageLayoutHeading>Groups</PageLayoutHeading>
					<CreateGroupDialog>
						<DialogTrigger as={Button} class="ml-auto">
							Create New Group
						</DialogTrigger>
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
} from "@mattrax/ui";
import { Form, InputField, createZodForm } from "@mattrax/ui/forms";
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
		<DialogRoot>
			{props.children}
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
