import { Input } from "@mattrax/ui";
import { createAsync } from "@solidjs/router";
import { createQuery } from "@tanstack/solid-query";
import { createColumnHelper } from "@tanstack/solid-table";
import { For, ParentProps, Show, Suspense, createSignal } from "solid-js";
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

			<Content {...props} />
		</div>
	);
}

function Content(props: ReturnType<typeof createSearchPageContext>) {
	// TODO: Optionally render results as chart or state item

	// TODO: Remove this
	const hasAnyItemFilter = () =>
		props.filters().some((f) => f.type === "enum" && f.target === "type");

	const data = createAsync(async () => {
		let result: any[] = [];
		for (const [key, def] of Object.entries(filters)) {
			if (
				!hasAnyItemFilter() ||
				props
					.filters()
					.some(
						(f) => f.type === "enum" && f.target === "type" && f.value === key,
					)
			) {
				result = result.concat(await def.load());
			}
		}

		// console.log("RESULT", result); // TODO
		return result;
	});

	const table = createStandardTable({
		get data() {
			return data() || [];
		},
		get columns() {
			// Get all of the possible columns given the active filters
			const columns = Object.entries(filters).flatMap(([key, info]) => {
				const isThisItemActive = props
					.filters()
					.some(
						(f) => f.type === "enum" && f.target === "type" && f.value === key,
					);
				if (hasAnyItemFilter() && !isThisItemActive) return [];

				return info.columns();
			});

			// Filter out duplicate columns by accessorKey
			// TODO: Which definition should we use if they render differently (Eg. different link)
			const filteredColumns = columns.filter(
				(a, index) =>
					index === columns.findIndex((b) => a.accessorKey === b.accessorKey),
			);

			return [selectCheckboxColumn, ...filteredColumns];
		},
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
		<Suspense>
			<StandardTable table={table} />

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
		</Suspense>
	);
}
