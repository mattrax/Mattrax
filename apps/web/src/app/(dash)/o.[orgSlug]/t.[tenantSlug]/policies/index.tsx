import { withDependantQueries } from "@mattrax/trpc-server-function/client";
import {
	AsyncButton,
	Button,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogRoot,
	DialogTitle,
	DropdownMenuTrigger,
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@mattrax/ui";
import { A, type RouteDefinition } from "@solidjs/router";
import { createColumnHelper } from "@tanstack/solid-table";
import {
	Match,
	Suspense,
	Switch,
	createSignal,
	startTransition,
} from "solid-js";
import type { ParentProps } from "solid-js";

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
import IconCarbonCaretDown from "~icons/carbon/caret-down";

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
	const tenantSlug = useTenantSlug();

	const policies = trpc.policy.list.createQuery(() => ({
		tenantSlug: tenantSlug(),
	}));
	cacheMetadata("policy", () => policies.data ?? []);

	const table = createStandardTable({
		get data() {
			return policies.data || [];
		},
		columns,
	});

	createSearchParamFilter(table, "name", "search");

	const [dialog, setDialog] = createSignal<{
		open: boolean;
		data:
			| {
					type: "deleteSingle";
					data: NonNullable<typeof policies.data>[number];
			  }
			| { type: "deleteMany"; data: NonNullable<typeof policies.data> };
	}>({ open: false, data: { type: "deleteMany", data: [] } });

	const deletePolicies = trpc.policy.delete.createMutation(() => ({
		onSuccess: () =>
			policies.refetch().then(() => {
				table.resetRowSelection(true);
				setDialog({ ...dialog(), open: false });
			}),
	}));

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
								{pluralize("Policy", table.getSelectedRowModel().rows.length)}
							</DialogTitle>
							<DialogDescription>
								Are you sure you want to delete{" "}
								<Switch>
									<Match when={dialog().data?.type === "deleteMany"}>
										{table.getSelectedRowModel().rows.length}{" "}
										{pluralize(
											"policy",
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
										return deletePolicies.mutateAsync({
											tenantSlug: tenantSlug(),
											ids: data.data.map(({ id }) => id),
										});
									}

									return deletePolicies.mutateAsync({
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

import { useNavigate } from "@solidjs/router";
import { z } from "zod";

import { Form, InputField, createZodForm } from "@mattrax/ui/forms";
import pluralize from "pluralize";
import { TableSearchParamsInput } from "~/components/TableSearchParamsInput";
import { PageLayout, PageLayoutHeading } from "~c/PageLayout";
import { useTenantSlug } from "../ctx";
import { cacheMetadata } from "../metadataCache";
import { Dialog } from "@kobalte/core/dialog";

function CreatePolicyDialog(props: ParentProps) {
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
			{props.children}

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
