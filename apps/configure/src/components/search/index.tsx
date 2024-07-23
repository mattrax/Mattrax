import { Input } from "@mattrax/ui";
import { createQuery } from "@tanstack/solid-query";
import { createColumnHelper } from "@tanstack/solid-table";
import { Show, Suspense, createSignal } from "solid-js";
import {
	FloatingSelectionBar,
	StandardTable,
	createStandardTable,
	selectCheckboxColumn,
} from "~/components/StandardTable";
import { db } from "~/lib/db";
import { FilterBar } from "./FilterBar";
import { type Filter, filters } from "./filters";

export function createSearchPageContext(defaultFilters: Filter[] = []) {
	// TODO: We should probs put some of this state into the URL???

	const [filters, setFilters] = createSignal<Filter[]>(defaultFilters);

	return { filters, setFilters, defaultFilters };
}

// TODO: Break the following into `filters.ts` once refactored

const column = createColumnHelper<any>(); // TODO: Not using any
const columns = [
	selectCheckboxColumn,
	column.accessor("name", {
		header: "Name",
		cell: (props) => (
			<a
				class="font-medium hover:underline focus:underline p-1 -m-1 w-full block"
				href="todo" // TODO: {`/users/${props.row.original.id}`}
			>
				{props.row.original.name}
			</a>
		),
	}),
	// TODO: This needs to dispatch to the correct entity type to render it
];

export function SearchPage(
	props: ReturnType<typeof createSearchPageContext> & {
		showFilterBar?: boolean;
	},
) {
	// TODO: Ordering
	// TODO: Result format (table or chart)

	// TODO: Make this reactive to DB changes!!!
	const query = createQuery(() => ({
		queryKey: ["search", props.filters()],
		// TODO: Filtering inside or outside Tanstack Query??? I can see merits both ways
		queryFn: async (ctx) => {
			let result: any[] = [];

			const d = await db;
			const activeFilters = ctx.queryKey[1] as Filter[];

			if (activeFilters.some((f) => f.type === "enum" && f.target === "type")) {
				for (const filter of activeFilters) {
					if (filter.type === "enum" && filter.target === "type") {
						switch (filter.value) {
							case "users":
								result = result.concat(await d.getAll("users"));
								break;
							case "devices":
								result = result.concat(await d.getAll("devices"));
								break;
							case "groups":
								result = result.concat(await d.getAll("groups"));
								break;
							case "policies":
								result = result.concat(await d.getAll("policies"));
								break;
							case "apps":
								result = result.concat(await d.getAll("apps"));
								break;
						}
					}
				}
			} else {
				result = result.concat(await d.getAll("users"));
				result = result.concat(await d.getAll("devices"));
				result = result.concat(await d.getAll("groups"));
				result = result.concat(await d.getAll("policies"));
				result = result.concat(await d.getAll("apps"));
			}

			const searchQuery = activeFilters.find(
				(f) => f.type === "string" && f.op === "eq",
			);
			if (searchQuery) {
				result = result.filter((r) => {
					for (const [key, value] of Object.entries(r)) {
						if (
							typeof value === "string" &&
							value.toLowerCase().includes(searchQuery.value.toLowerCase())
						) {
							return true;
						}
					}
					return false;
				});
			}

			return result;
		},
	}));

	return (
		<div class="p-4">
			{/* // TODO: Don't use `eq` op cause this should be full-text search */}
			<div class="relative">
				<div class="absolute top-0 bottom-0 pl-2 text-center">
					<div class="flex items-center justify-center h-full">
						<IconPhMagnifyingGlass />
					</div>
				</div>
				{/* // TODO: Debounce input a bit */}
				<Input
					placeholder="Search"
					class="mb-2 select-none pl-8"
					value={
						props.filters().find((f) => f.type === "string" && f.op === "eq")
							?.value ?? ""
					}
					onInput={(e) => {
						// TODO: Tack this on and update if we already have a search one????
						props.setFilters((filters) => [
							...(e.currentTarget.value === ""
								? []
								: ([
										{
											type: "string",
											op: "eq",
											// TODO: Search all fields but allow the user to refine it to a specific field???
											value: e.currentTarget.value,
										},
									] as const)),
							...filters.filter((f) => !(f.type === "string" && f.op === "eq")),
						]);
					}}
				/>
				<Show
					when={
						props
							.filters()
							.find((f) => f.type === "string" && f.op === "eq") !== undefined
					}
				>
					<button
						type="button"
						class="absolute top-0 bottom-0 right-0 pr-2 text-center"
						onClick={() =>
							props.setFilters((filters) =>
								filters.filter((f) => !(f.type === "string" && f.op === "eq")),
							)
						}
					>
						<div class="flex items-center justify-center h-full">
							<IconPhX />
						</div>
					</button>
				</Show>
			</div>
			<Show when={props.showFilterBar !== false}>
				<FilterBar {...props} />
			</Show>

			{/* // TODO: Optionally render results as chart or state item */}

			<Show
				when={props
					.filters()
					.find((f) => f.type === "enum" && f.target === "type")}
			>
				{(filter) => {
					// @ts-expect-error // TODO: Fix this
					const columns = filters?.[filter().value]?.table();
					if (!columns) return <p>TODO</p>; // TODO: Make this not possible?

					const table = createStandardTable({
						get data() {
							return query.data || [];
						},
						columns: [selectCheckboxColumn, ...columns],
					});
					// createSearchParamFilter(table, "name", "search");

					// const dialog = createBulkDeleteDialog({
					// 	table,
					// 	onDelete: (data) => {
					// 		console.log(data);
					// 		alert("Do delete"); // TODO
					// 	},
					// });

					return (
						<>
							<Suspense>
								<StandardTable table={table} />
							</Suspense>
							<FloatingSelectionBar table={table}>
								{(rows) => (
									<>
										{/* <Button
									variant="destructive"
									size="sm"
									onClick={() => dialog.show(rows())}
								>
									Delete
								</Button> */}
									</>
								)}
							</FloatingSelectionBar>
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
						</>
					);
				}}
			</Show>
		</div>
	);
}
