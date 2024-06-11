import { withDependantQueries } from "@mattrax/trpc-server-function/client";
import { Button, Popover, PopoverContent, PopoverTrigger } from "@mattrax/ui";
import { A, type RouteDefinition } from "@solidjs/router";
import { createColumnHelper } from "@tanstack/solid-table";
import type { ParentProps } from "solid-js";
import { Match, Suspense, Switch, startTransition } from "solid-js";

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

function createPoliciesQuery() {
	const tenantSlug = useTenantSlug();

	const policies = trpc.policy.list.createQuery(() => ({
		tenantSlug: tenantSlug(),
	}));
	cacheMetadata("policy", () => policies.data ?? []);

	return policies;
}

export default function Page() {
	const tenantSlug = useTenantSlug();
	const policies = createPoliciesQuery();

	const table = createStandardTable({
		get data() {
			return policies.data || [];
		},
		columns,
	});

	createSearchParamFilter(table, "name", "search");

	const deletePolicies = trpc.policy.delete.createMutation(() => ({
		onSuccess: () => policies.refetch(),
	}));

	const dialog = createBulkDeleteDialog({
		table,
		onDelete: (data) =>
			deletePolicies.mutateAsync({
				tenantSlug: tenantSlug(),
				ids: data.map(({ id }) => id),
			}),
	});

	return (
		<PageLayout
			heading={
				<>
					<PageLayoutHeading>Policies</PageLayoutHeading>
					<CreatePolicyDialog>
						<PopoverTrigger as={Button} class="ml-auto">
							Create Policy
						</PopoverTrigger>
					</CreatePolicyDialog>
				</>
			}
		>
			<div class="flex flex-row gap-4">
				<TableSearchParamsInput query={policies} class="flex-1" />
			</div>
			<Suspense>
				<StandardTable table={table} />
				<BulkDeleteDialog
					dialog={dialog}
					title={({ count }) => <>Delete {pluralize("Policy", count())}</>}
					description={({ count, rows }) => (
						<>
							Are you sure you want to delete{" "}
							<Switch>
								<Match when={count() > 1}>
									{count()} {pluralize("policy", count())}
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
			</Suspense>
		</PageLayout>
	);
}

import { Form, InputField, createZodForm } from "@mattrax/ui/forms";
import { useNavigate } from "@solidjs/router";
import pluralize from "pluralize";
import { z } from "zod";

import {
	BulkDeleteDialog,
	createBulkDeleteDialog,
} from "~/components/BulkDeleteDialog";
import { TableSearchParamsInput } from "~/components/TableSearchParamsInput";
import { PageLayout, PageLayoutHeading } from "~c/PageLayout";
import { useTenantSlug } from "../ctx";
import { cacheMetadata } from "../metadataCache";

function CreatePolicyDialog(props: ParentProps) {
	const tenantSlug = useTenantSlug();
	const navigate = useNavigate();

	const users = trpc.user.list.createQuery(
		() => ({ tenantSlug: tenantSlug() }),
		() => ({ enabled: false }),
	);
	const gettingStarted = trpc.tenant.gettingStarted.createQuery(
		() => ({ tenantSlug: tenantSlug() }),
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
						placeholder="Policy Name"
						autocomplete="off"
					/>
					<Button type="submit">Create Policy</Button>
				</Form>
			</PopoverContent>
		</Popover>
	);
}
