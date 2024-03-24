import { As } from "@kobalte/core";
import { A, type RouteDefinition } from "@solidjs/router";
import { createColumnHelper } from "@tanstack/solid-table";
import { Suspense, startTransition } from "solid-js";

import IconCarbonCaretDown from "~icons/carbon/caret-down.jsx";
import type { RouterOutput } from "~/api/trpc";
import {
	ColumnsDropdown,
	StandardTable,
	createStandardTable,
	createSearchParamPagination,
	selectCheckboxColumn,
} from "~/components/StandardTable";
import {
	Button,
	Input,
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@mattrax/ui";
import { trpc } from "~/lib";

export const route = {
	load: ({ params }) => {
		trpc.useContext().policy.list.ensureData({
			tenantSlug: params.tenantSlug!,
		});
	},
} satisfies RouteDefinition;

const column = createColumnHelper<RouterOutput["policy"]["list"][number]>();

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
	// TODO: Description
	// TODO: Configurations maybe?
	// TODO: Supported OS's
];

function createPoliciesTable() {
	const params = useZodParams({ tenantSlug: z.string() });
	const policies = trpc.policy.list.useQuery(() => params);

	const table = createStandardTable({
		get data() {
			return policies.data || [];
		},
		columns,
		pagination: true,
	});

	createSearchParamPagination(table, "page");

	return { policies, table };
}

// TODO: Infinite scroll

// TODO: Disable search, filters and sort until all backend metadata has loaded in. Show tooltip so it's clear what's going on.

export default function Page() {
	const { table, policies } = createPoliciesTable();

	return (
		<PageLayout heading={<PageLayoutHeading>Policies</PageLayoutHeading>}>
			<div class="flex flex-row gap-4">
				<Input
					placeholder={!policies.data ? "Loading..." : "Search..."}
					disabled={!policies.data}
					value={(table.getColumn("name")?.getFilterValue() as string) ?? ""}
					onInput={(event) =>
						table.getColumn("name")?.setFilterValue(event.target.value)
					}
					class="flex-1"
				/>
				<ColumnsDropdown table={table}>
					<As component={Button} variant="outline" class="ml-auto select-none">
						Columns
						<IconCarbonCaretDown class="ml-2 h-4 w-4" />
					</As>
				</ColumnsDropdown>

				<CreatePolicyButton />
			</div>
			<Suspense>
				<StandardTable table={table} />
			</Suspense>
		</PageLayout>
	);
}

import { useNavigate } from "@solidjs/router";
import { z } from "zod";

import { Form, InputField, createZodForm } from "@mattrax/ui/forms";
import { PageLayout, PageLayoutHeading } from "~/app/(dash)/PageLayout";
import { useZodParams } from "~/lib/useZodParams";
import { useTenantSlug } from "../../[tenantSlug]";

function CreatePolicyButton() {
	const tenantSlug = useTenantSlug();
	const navigate = useNavigate();

	const createPolicy = trpc.policy.create.useMutation(() => ({
		onSuccess: async (policyId) => {
			await startTransition(() => navigate(policyId));
		},
	}));

	const form = createZodForm({
		schema: z.object({ name: z.string() }),
		onSubmit: ({ value }) =>
			createPolicy.mutateAsync({
				name: value.name,
				tenantSlug: tenantSlug(),
			}),
	});

	return (
		<Popover>
			<PopoverTrigger asChild>
				<As component={Button}>Add New</As>
			</PopoverTrigger>
			<PopoverContent>
				<Form
					form={form}
					class="w-full"
					fieldsetClass="flex flex-col items-center gap-4 w-full"
				>
					<InputField
						placeholder="Policy Name"
						class="w-full"
						fieldClass="flex-1 w-full"
						form={form}
						name="name"
					/>
					<Button type="submit" class="w-full">
						Create
					</Button>
				</Form>
			</PopoverContent>
		</Popover>
	);
}
