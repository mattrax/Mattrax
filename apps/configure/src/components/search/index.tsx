import { Input, LineChart } from "@mattrax/ui";
import { useSearchParams } from "@solidjs/router";
import { createQuery } from "@tanstack/solid-query";
import { Show, Suspense, createSignal } from "solid-js";
import { db } from "~/lib/db";
import { FilterBar } from "./FilterBar";
import { TableContent } from "./TableContent";
import type { ColumnDefinitions, Filter } from "./filters";

export function createSearchPageContext(defaultFilters: Filter[] = []) {
	const [searchParams] = useSearchParams();

	// TODO: We should probs put some of this state into the URL???
	const [filters, setFilters] = createSignal<Filter[]>(defaultFilters);

	// TODO: ordering

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
	const chartData = {
		labels: ["January", "February", "March", "April", "May"],
		datasets: [
			{
				label: "Sales",
				data: [50, 60, 70, 80, 90],
				fill: true, // remove if you want a Line Chart
			},
		],
	};

	return (
		<Suspense
			fallback={
				<Show when>
					{() =>
						(
							// TODO: We don't want this. Theorically the table should suspend on a row level and can remove this barrier.
							// biome-ignore lint/style/noCommaOperator: <explanation>
							console.error("Table parent suspended!"), null
						)}
				</Show>
			}
		>
			<TableContent {...props} />

			{/* // TODO: Area chart, Pie chart, Bar chart */}
			{/* <div class="h-96">
				<LineChart data={chartData} />
			</div> */}

			{/* // TODO: StatItem */}
		</Suspense>
	);
}
