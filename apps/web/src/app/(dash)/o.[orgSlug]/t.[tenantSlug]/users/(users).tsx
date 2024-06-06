import { Dialog } from "@kobalte/core/dialog";
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
	DropdownMenuTrigger,
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@mattrax/ui";
import { A, type RouteDefinition } from "@solidjs/router";
import { createColumnHelper } from "@tanstack/solid-table";
import { Match, Show, Suspense, Switch, createSignal } from "solid-js";

import pluralize from "pluralize";
import type { RouterOutput } from "~/api/trpc";
import { TableSearchParamsInput } from "~/components/TableSearchParamsInput";
import { trpc } from "~/lib";
import { AUTH_PROVIDER_DISPLAY } from "~/lib/values";
import { PageLayout, PageLayoutHeading } from "~c/PageLayout";
import {
	FloatingSelectionBar,
	StandardTable,
	createSearchParamFilter,
	createStandardTable,
	selectCheckboxColumn,
} from "~c/StandardTable";
import IconCarbonCaretDown from "~icons/carbon/caret-down.jsx";
import IconCarbonCaretSort from "~icons/carbon/caret-sort.jsx";
import IconMaterialSymbolsWarningRounded from "~icons/material-symbols/warning-rounded.jsx";
import { useTenantSlug } from "../ctx";
import { cacheMetadata } from "../metadataCache";

export const route = {
	load: ({ params }) => {
		trpc.useContext().user.list.ensureData({
			tenantSlug: params.tenantSlug!,
		});
	},
} satisfies RouteDefinition;

const column = createColumnHelper<RouterOutput["user"]["list"][number]>();

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
	column.accessor("email", {
		header: ({ column }) => {
			return (
				<Button
					variant="ghost"
					onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
				>
					Email
					{/* TODO: Indicate which way we are sorting */}
					<IconCarbonCaretSort class="ml-2 h-4 w-4" />
				</Button>
			);
		},
	}),
	column.accessor("provider.variant", {
		header: "Provider",
		cell: (props) => {
			const providerDisplayName = () => AUTH_PROVIDER_DISPLAY[props.getValue()];
			return (
				<span class="flex flex-row gap-1 items-center">
					<Badge variant="outline">{providerDisplayName()}</Badge>
					<Show when={props.row.original.resourceId === null}>
						<Tooltip>
							<TooltipTrigger>
								<IconMaterialSymbolsWarningRounded class="w-4 h-4 text-yellow-600" />
							</TooltipTrigger>
							<TooltipContent>
								User not found in {providerDisplayName()}
							</TooltipContent>
						</Tooltip>
					</Show>
				</span>
			);
		},
	}),
	// TODO: Link to OAuth provider
	// TODO: Actions
];

export default function Page() {
	const tenantSlug = useTenantSlug();

	const users = trpc.user.list.createQuery(() => ({
		tenantSlug: tenantSlug(),
	}));
	cacheMetadata("user", () => users.data ?? []);

	const table = createStandardTable({
		get data() {
			return users.data || [];
		},
		columns,
	});

	createSearchParamFilter(table, "name", "search");

	const [dialog, setDialog] = createSignal<{
		open: boolean;
		data:
			| {
					type: "deleteSingle";
					data: NonNullable<typeof users.data>[number];
			  }
			| { type: "deleteMany"; data: NonNullable<typeof users.data> };
	}>({ open: false, data: { type: "deleteMany", data: [] } });

	const deleteUsers = trpc.user.delete.createMutation(() => ({
		onSuccess: () =>
			users.refetch().then(() => {
				table.resetRowSelection(true);
				setDialog({ ...dialog(), open: false });
			}),
	}));

	return (
		<PageLayout heading={<PageLayoutHeading>Users</PageLayoutHeading>}>
			<div class="flex flex-row items-center gap-4">
				<TableSearchParamsInput query={users} class="flex-1" />
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
								{pluralize("User", table.getSelectedRowModel().rows.length)}
							</DialogTitle>
							<DialogDescription>
								Are you sure you want to delete{" "}
								<Switch>
									<Match when={dialog().data?.type === "deleteMany"}>
										{table.getSelectedRowModel().rows.length}{" "}
										{pluralize("user", table.getSelectedRowModel().rows.length)}
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
										return deleteUsers.mutateAsync({
											tenantSlug: tenantSlug(),
											ids: data.data.map(({ id }) => id),
										});
									}

									return deleteUsers.mutateAsync({
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
