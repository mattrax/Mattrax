import { As } from "@kobalte/core";
import { A, type RouteDefinition } from "@solidjs/router";
import { createColumnHelper } from "@tanstack/solid-table";
import { Suspense, startTransition } from "solid-js";
import { withDependantQueries } from "@mattrax/trpc-server-function/client";

import type { RouterOutput } from "~/api/trpc";
import {
	StandardTable,
	createStandardTable,
	createSearchParamPagination,
	selectCheckboxColumn,
	createSearchParamFilter,
} from "~c/StandardTable";
import { Button, Popover, PopoverContent, PopoverTrigger } from "@mattrax/ui";
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

// TODO: Infinite scroll

// TODO: Disable search, filters and sort until all backend metadata has loaded in. Show tooltip so it's clear what's going on.

export default function Page() {
	const params = useZodParams({ tenantSlug: z.string() });

	const policies = trpc.policy.list.createQuery(() => params);
	cacheMetadata("policy", () => policies.data ?? []);

	const table = createStandardTable({
		get data() {
			return policies.data || [];
		},
		columns,
		pagination: true,
	});

	createSearchParamPagination(table, "page");
	createSearchParamFilter(table, "name", "search");

	return (
		<PageLayout heading={<PageLayoutHeading>Policies</PageLayoutHeading>}>
			<div class="flex flex-row gap-4">
				<TableSearchParamsInput query={policies} class="flex-1" />
				{/* <ColumnsDropdown table={table}>
					<As component={Button} variant="outline" class="ml-auto select-none">
						Columns
						<IconCarbonCaretDown class="ml-2 h-4 w-4" />
					</As>
				</ColumnsDropdown> */}

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
import { PageLayout, PageLayoutHeading } from "~c/PageLayout";
import { useZodParams } from "~/lib/useZodParams";
import { useTenantSlug } from "../../t.[tenantSlug]";
import { TableSearchParamsInput } from "~/components/TableSearchParamsInput";
import { cacheMetadata } from "../metadataCache";

function CreatePolicyButton() {
	const tenantSlug = useTenantSlug();
	const navigate = useNavigate();

	const users = trpc.user.list.createQuery(
		() => ({
			tenantSlug: tenantSlug(),
		}),
		() => ({ enabled: false }),
	);
	const gettingStarted = trpc.tenant.gettingStarted.createQuery(
		() => ({
			tenantSlug: tenantSlug(),
		}),
		() => ({ enabled: false }),
	);

	const createPolicy = trpc.policy.create.createMutation(() => ({
		onSuccess: (policyId) => startTransition(() => navigate(policyId)),
		...withDependantQueries([users, gettingStarted]),
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
			<PopoverContent class="p-4">
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
