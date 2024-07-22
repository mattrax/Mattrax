import { Button } from "@mattrax/ui";
import { A } from "@solidjs/router";
import { createColumnHelper } from "@tanstack/solid-table";
import { Suspense } from "solid-js";
import { type Database, createIdbQuery } from "~/lib/db";
import { createBulkDeleteDialog } from "~c/BulkDeleteDialog";
import { PageLayout, PageLayoutHeading } from "~c/PageLayout";
import {
	FloatingSelectionBar,
	StandardTable,
	createSearchParamFilter,
	createStandardTable,
	selectCheckboxColumn,
} from "~c/StandardTable";
import { TableSearchParamsInput } from "~c/TableSearchParamsInput";

const column = createColumnHelper<Database["users"]["value"]>();

const columns = [
	selectCheckboxColumn,
	column.accessor("name", {
		header: "Name",
		cell: (props) => (
			<A
				class="font-medium hover:underline focus:underline p-1 -m-1 w-full block"
				href={`/users/${props.row.original.id}`}
			>
				{props.row.original.name}
			</A>
		),
	}),
	// column.accessor("email", {
	// 	header: ({ column }) => {
	// 		return (
	// 			<Button variant="ghost" onClick={() => column.toggleSorting()}>
	// 				Email
	// 				<Switch fallback={<IconCarbonCaretSort class="ml-2 h-4 w-4" />}>
	// 					<Match when={column.getIsSorted() === "asc"}>
	// 						<IconCarbonCaretSortUp class="ml-2 h-4 w-4" />
	// 					</Match>
	// 					<Match when={column.getIsSorted() === "desc"}>
	// 						<IconCarbonCaretSortDown class="ml-2 h-4 w-4" />
	// 					</Match>
	// 				</Switch>
	// 			</Button>
	// 		);
	// 	},
	// }),
	// column.accessor("provider.variant", {
	// 	header: "Provider",
	// 	cell: (props) => {
	// 		const providerDisplayName = () => AUTH_PROVIDER_DISPLAY[props.getValue()];
	// 		return (
	// 			<span class="flex flex-row gap-1 items-center">
	// 				<Badge variant="outline">{providerDisplayName()}</Badge>
	// 				<Show when={props.row.original.resourceId === null}>
	// 					<Tooltip>
	// 						<TooltipTrigger>
	// 							<IconMaterialSymbolsWarningRounded class="w-4 h-4 text-yellow-600" />
	// 						</TooltipTrigger>
	// 						<TooltipContent>
	// 							User not found in {providerDisplayName()}
	// 						</TooltipContent>
	// 					</Tooltip>
	// 				</Show>
	// 			</span>
	// 		);
	// 	},
	// }),
	// TODO: Link to OAuth provider
	// TODO: Actions
];

export default function Page() {
	const users = createIdbQuery("users");

	const table = createStandardTable({
		get data() {
			return users.data || [];
		},
		columns,
	});
	createSearchParamFilter(table, "name", "search");

	const dialog = createBulkDeleteDialog({
		table,
		onDelete: (data) => {
			console.log(data);
			alert("Do delete"); // TODO
		},
	});

	return (
		<PageLayout heading={<PageLayoutHeading>Users</PageLayoutHeading>}>
			<div class="flex flex-row items-center gap-4">
				<TableSearchParamsInput query={users} class="flex-1" />
			</div>
			<Suspense>
				<StandardTable table={table} />
				{/* <BulkDeleteDialog
					dialog={dialog}
					title={({ count }) => <>Delete {pluralize("User", count())}</>}
					description={({ count, rows }) => (
						<>
							Are you sure you want to delete{" "}
							<Switch>
								<Match when={count() > 1}>
									{count()} {pluralize("user", count())}
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
				/> */}
				<FloatingSelectionBar table={table}>
					{(rows) => (
						<>
							<Button
								variant="destructive"
								size="sm"
								onClick={() => dialog.show(rows())}
							>
								Delete
							</Button>
							<Button size="sm" onClick={() => alert("todo")}>
								Assign
							</Button>
						</>
					)}
				</FloatingSelectionBar>
			</Suspense>
		</PageLayout>
	);
}
