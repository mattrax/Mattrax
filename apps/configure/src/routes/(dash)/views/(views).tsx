import { A } from "@solidjs/router";
import { createColumnHelper } from "@tanstack/solid-table";
import type { InferStoreValue } from "~/lib/db";
import { createDbQuery } from "~/lib/query";
import { createBulkDeleteDialog } from "~c/BulkDeleteDialog";
import { PageLayout, PageLayoutHeading } from "~c/PageLayout";
import {
	StandardTable,
	createSearchParamFilter,
	createStandardTable,
	selectCheckboxColumn,
} from "~c/StandardTable";

const column = createColumnHelper<InferStoreValue<"views">>();

const columns = [
	selectCheckboxColumn,
	column.accessor("name", {
		header: "Name",
		cell: (props) => (
			<A
				class="font-medium hover:underline focus:underline p-1 -m-1 w-full block"
				href={props.row.original.id}
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
	const views = createDbQuery((db) => db.getAll("views"));

	const table = createStandardTable({
		get data() {
			return views() || [];
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

	// TODO: Create, open and delete views

	// TODO: Can we make create an action after ephemerally constructing the search????

	return (
		<PageLayout
			heading={
				<>
					<PageLayoutHeading>Views</PageLayoutHeading>
					<p>
						Create views from{" "}
						<A href="../search" class="underline">
							search
						</A>
					</p>
				</>
			}
		>
			<StandardTable table={table} />
		</PageLayout>
	);
}
