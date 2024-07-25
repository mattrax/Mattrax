import { createEscapeKeyDown } from "@kobalte/core";
import {
	Button,
	Checkbox,
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
	Input,
	Popover,
	PopoverContent,
	PopoverTrigger,
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@mattrax/ui";
import { createEventListener } from "@solid-primitives/event-listener";
import { makeResizeObserver } from "@solid-primitives/resize-observer";
import { ReactiveSet } from "@solid-primitives/set";
import { createAsync } from "@solidjs/router";
import { createQuery } from "@tanstack/solid-query";
import { createWindowVirtualizer } from "@tanstack/solid-virtual";
import {
	For,
	Show,
	Suspense,
	createEffect,
	createMemo,
	createSignal,
	onMount,
	startTransition,
	untrack,
} from "solid-js";
import { createMutable } from "solid-js/store";
import { db } from "~/lib/db";
import { FilterBar } from "./FilterBar";
import { entities } from "./configuration";
import type { ColumnDefinitions, Filter } from "./filters";

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
	// TODO: Optionally render results as chart or counter

	// const table = createStandardTable({
	// 	data: [],
	// 	columns: [],
	// });
	// createSearchParamFilter(table, "name", "search");

	// const dialog = createBulkDeleteDialog({
	// 	table,
	// 	onDelete: (data) => {
	// 		console.log(data);
	// 		alert("Do delete"); // TODO
	// 	},
	// });

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

// TODO: Break out into `table.tsx`
function TableContent(props: ReturnType<typeof createSearchPageContext>) {
	const selected = new ReactiveSet<number>([]);
	const toggleSelected = (index: number) =>
		selected.has(index) ? selected.delete(index) : selected.add(index);

	// TODO: If `data` changes automatically remove all items from `selected` that are no longer in the list

	// TODO: Remove this
	const hasAnyItemFilter = () =>
		props.filters().some((f) => f.type === "enum" && f.target === "type");

	const [ordering, setOrdering] = createSignal<"asc" | "desc">("asc");
	const [orderedBy, setOrderedBy] = createSignal("name"); // TODO: Work out this default
	const toggleOrdering = (key: string) => () => {
		setOrdering(
			orderedBy() !== key ? "asc" : (o) => (o === "asc" ? "desc" : "asc"),
		);
		setOrderedBy(key);
	};

	const rawData = createAsync(async () => {
		const result = (
			await Promise.all(
				Object.entries(entities).map(async ([key, def]) => {
					if (
						!hasAnyItemFilter() ||
						props
							.filters()
							.some(
								(f) =>
									f.type === "enum" && f.target === "type" && f.value === key,
							)
					) {
						return (await def.load()).map((data) => ({ type: key, data }));
					}

					return [];
				}),
			)
		).flat();

		return result;
	});

	// TODO: Really we wanna do ordering in IndexedDB so that we can only load active data the virtualiser requires????

	// TODO:
	// TODO: - Get config from UI/URL (maybe break out implementation to the `filters` object too)
	// TODO: - Sorting by multiple columns
	// TODO: - Sorting by multiple data types (Eg. String, number, boolean, enum)
	// TODO: - Handling of columns not on an entity
	const orderedData = createMemo(() => {
		const d = rawData();
		if (!d) return [];

		return d.sort((a, b) => a.data.name.localeCompare(b.data.name));
	});

	const virtualizer = createWindowVirtualizer({
		// TODO: Can we guess the number of rows and rely on `Suspense` on each row for a loading state???
		get count() {
			return orderedData()?.length ?? 0;
		},
		estimateSize: () => 52.5,
		overscan: 30,
	});

	// TODO: Deduplicate with `columns` implementation
	const actions = createMemo(() => {
		// Get all of the possible columns given the active filters
		const actions = Object.entries(entities).flatMap(([key, info]) => {
			const isThisItemActive = props
				.filters()
				.some(
					(f) => f.type === "enum" && f.target === "type" && f.value === key,
				);
			if (hasAnyItemFilter() && !isThisItemActive) return [];
			return Object.entries(info?.actions || {});
		});

		// Filter out duplicate columns by key (picking the first one for the `header`)
		const filteredActions = actions.filter(
			(a, index) => index === actions.findIndex((b) => a[0] === b[0]),
		);

		return filteredActions;
	});

	const defaultColumns = createMemo(() => {
		// Get all of the possible columns given the active filters
		const columns = Object.entries(entities).flatMap(([key, info]) => {
			const isThisItemActive = props
				.filters()
				.some(
					(f) => f.type === "enum" && f.target === "type" && f.value === key,
				);
			if (hasAnyItemFilter() && !isThisItemActive) return [];
			return Object.entries(info?.columns || {});
		});

		// Filter out duplicate columns by key (picking the first one for the `header`)
		const filteredColumns = columns.filter(
			(a, index) => index === columns.findIndex((b) => a[0] === b[0]),
		);

		return filteredColumns;
	});

	// TODO: Allow the user to enable/disable columns
	const [columns, setColumns] = createSignal(
		[] as [string, ColumnDefinitions<any>][],
	);

	// TODO: When filters changes it will wreak havoc on the columns. We need to handle this better.
	createEffect(() => setColumns(defaultColumns()));

	// Store the width of each column so the user can resize them
	const columnWidths = createMutable<Record<string, number>>({});
	const columnContentMaxWidths = createMutable<Record<string, number>>({});
	createEffect(() => {
		const c = columns();
		if (!c) return;

		for (const [key, info] of c) {
			const expected = info.size === "auto" ? undefined : info.size;
			// We untrack so when `columnsSizes` is updated, we don't re-run this effect as it would fix the size to the default.
			// The effect only needs to run when the active columns change to ensure we have the default sizes set.
			untrack(() => {
				if (columnWidths[key] !== expected) columnWidths[key] = expected;
			});
		}
	});

	// As the virtualizer only accounts for the table body, we track the height w/ the header for the resize column bars.
	const [tableHeight, setTableHeight] = createSignal<number>(0);
	const { observe } = makeResizeObserver((event) => {
		for (const entry of event) {
			if (entry.target instanceof HTMLTableElement)
				setTableHeight(entry.target.clientHeight);
		}
	});

	let tableHeaderRowRef!: HTMLTableRowElement;

	return (
		<>
			<div class="flex space-x-4">
				{/* // TODO: Replace "items" with the valid entities that can be returned??? */}
				<p class="text-sm py-2">Got {orderedData()?.length ?? 0} items</p>

				<DropdownMenu>
					<DropdownMenuTrigger class="select-none">Columns</DropdownMenuTrigger>
					<DropdownMenuContent>
						<For each={defaultColumns()}>
							{([key, column]) => (
								<DropdownMenuCheckboxItem
									checked={columns().some(([k]) => k === key)}
									onChange={(checked) => {
										if (checked) {
											setColumns((columns) => [...columns, [key, column]]);
										} else {
											setColumns((columns) =>
												columns.filter(([k]) => k !== key),
											);
										}
									}}
								>
									{column.header}
								</DropdownMenuCheckboxItem>
							)}
						</For>
					</DropdownMenuContent>
				</DropdownMenu>

				<Popover>
					<PopoverTrigger>Display</PopoverTrigger>
					<PopoverContent>Place content for the popover here.</PopoverContent>
				</Popover>
			</div>

			<Table
				ref={(table) => observe(table)}
				// TODO: `onDrag` instead of `onDragEnd`???
				onDragEnd={(e) => {
					let moveAfter: string | null;
					for (const child of tableHeaderRowRef.children) {
						const colKey = child.getAttribute("data-col-key");
						const endPosition = child.getBoundingClientRect().left;

						if (e.clientX > endPosition) {
							moveAfter = colKey;
						}
					}

					console.log("MOVE AFTER", moveAfter);

					setColumns((columns) => {
						const newColumns = [...columns];
						const [draggedColumn] = newColumns.splice(
							newColumns.findIndex(([key]) => key === e.data),
							1,
						);
						const insertIndex = newColumns.findIndex(
							([key]) => key === moveAfter,
						);
						newColumns.splice(insertIndex, 0, draggedColumn);
						return newColumns;
					});
				}}
			>
				<TableHeader>
					{/* // TODO: We need to handle grouped columns by having multiple `TableRows`'s (for columns on 1-1 relations Eg. user name on device owner) */}
					<TableRow class="flex" ref={tableHeaderRowRef}>
						<TableHead class="size-12 flex justify-center items-center">
							<Checkbox
								checked={selected.size === orderedData()?.length}
								indeterminate={
									selected.size > 0 && selected.size < orderedData().length
								}
								onChange={(value) =>
									startTransition(() => {
										value
											? orderedData().forEach((_, i) => selected.add(i))
											: selected.clear();
									})
								}
								aria-label="Select all"
							/>
						</TableHead>

						<For each={columns()}>
							{([key, column]) => {
								let ref!: HTMLTableCellElement;

								const [isDragging, setIsDragging] = createSignal(false);
								createEventListener(ref, "mouseup", () => setIsDragging(false));

								return (
									<TableHead
										ref={ref}
										class="relative flex justify-start items-center"
										classList={{ "opacity-25 bg-red-500": isDragging() }}
										style={{
											...(columnWidths[key]
												? { width: `${columnWidths[key]}px` }
												: { flex: "1" }),
										}}
										draggable={isDragging()}
										// TODO: Keep or not
										data-col-key={key}
									>
										{column.header}

										<div class="flex-1" />

										<Tooltip>
											<TooltipTrigger
												as="div"
												class="select-none"
												onClick={toggleOrdering(key)}
												onKeyPress={toggleOrdering(key)}
											>
												<Show
													when={orderedBy() === key}
													fallback={
														<IconCarbonCaretSort class="ml-2 h-4 w-4" />
													}
												>
													<Show
														when={ordering() === "asc"}
														fallback={
															<IconCarbonCaretSortDown class="ml-2 h-4 w-4" />
														}
													>
														<IconCarbonCaretSortUp class="ml-2 h-4 w-4" />
													</Show>
												</Show>
											</TooltipTrigger>
											<TooltipContent>Ordering</TooltipContent>
										</Tooltip>

										{/* // TODO: Tooltip */}
										<IconPhDotsSixVerticalLight
											class="ml-2 h-4 w-4 cursor-grab"
											onMouseDown={() => setIsDragging(true)}
										/>

										<ColumnResizeBar
											tableHeight={tableHeight()}
											setWidth={(delta) => {
												// When `columnWidths[key]` is not set (Eg. for flex) we need to find out what is is within the DOM and set it.
												if (!columnWidths[key])
													columnWidths[key] = ref.clientWidth;
												columnWidths[key] = columnWidths[key] + delta;
											}}
											onDblClick={() => {
												if (columnContentMaxWidths[key] === undefined) return;
												columnWidths[key] = columnContentMaxWidths[key];
											}}
										/>
									</TableHead>
								);
							}}
						</For>
					</TableRow>
				</TableHeader>
				<TableBody
					class="w-full relative"
					style={{
						height: `${virtualizer.getTotalSize()}px`,
					}}
				>
					<For
						each={virtualizer.getVirtualItems()}
						fallback={
							<TableRow>
								<TableCell colSpan={columns().length} class="h-24 text-center">
									No results.
								</TableCell>
							</TableRow>
						}
					>
						{(virtualItem) => {
							const item = orderedData()[virtualItem.index]!;

							// TODO: Suspense at row level instead of table level

							return (
								<TableRow
									class="absolute w-full top-0 left-0 flex"
									style={{
										height: `${virtualItem.size}px`,
										transform: `translateY(${
											virtualItem.start - virtualizer.options.scrollMargin
										}px)`,
									}}
									data-state={selected.has(virtualItem.index) && "selected"}
								>
									<TableCell class="size-12">
										<Checkbox
											checked={selected.has(virtualItem.index)}
											onChange={() => toggleSelected(virtualItem.index)}
											aria-label="Select row"
										/>
									</TableCell>

									<For each={columns()}>
										{([key, _]) => {
											let ref!: HTMLTableCellElement;

											onMount(() => {
												if (
													columnContentMaxWidths[key] === undefined ||
													ref.scrollWidth > columnContentMaxWidths[key]
												)
													columnContentMaxWidths[key] = ref.scrollWidth;
											});

											return (
												<TableCell
													ref={ref}
													class="overflow-scroll"
													style={{
														...(columnWidths[key]
															? { width: `${columnWidths[key]}px` }
															: { flex: "1" }),
													}}
												>
													<Show when={entities[item.type].columns[key]}>
														{(col) => col().render(item.data)}
													</Show>
												</TableCell>
											);
										}}
									</For>
								</TableRow>
							);
						}}
					</For>
				</TableBody>
			</Table>

			<Show when={selected.size > 0}>
				{(_) => {
					createEscapeKeyDown({
						onEscapeKeyDown: () => selected.clear(),
					});

					return (
						<div class="animate-in fade-in slide-in-from-bottom-2 zoom-in-[0.98] bottom-6 inset-x-0 fixed flex flex-row justify-center pointer-events-none">
							<div class="p-2 rounded-lg bg-white border border-gray-100 text-sm flex flex-row items-stretch gap-2 pointer-events-auto shadow">
								<div class="flex flex-row items-center gap-1.5 ml-2">
									<span class="font-medium">{selected.size} Selected</span>
									<Button
										variant="ghost"
										size="iconSmall"
										onClick={() => selected.clear()}
									>
										<IconPhXBold class="w-4 h-4" />
									</Button>
								</div>
								<div class="my-1 w-px bg-gray-300" />

								<For each={actions()}>
									{([key, action]) => (
										<Button
											variant={action.variant || "ghost"}
											onClick={() =>
												action.apply(
													[...selected].map((i) => orderedData()[i]!.data),
												)
											}
										>
											{action.title}
										</Button>
									)}
								</For>

								<BulkExportButton data={orderedData()} columns={columns()} />
							</div>
						</div>
					);
				}}
			</Show>
		</>
	);
}

function ColumnResizeBar(props: {
	tableHeight: number;
	setWidth: (delta: number) => void;
	onDblClick?: () => void;
}) {
	let ref!: HTMLDivElement;
	const [lastMousePosition, setLastMousePosition] = createSignal<number>();

	createEventListener(document, "mouseup", () =>
		setLastMousePosition(undefined),
	);
	createEventListener(document, "mousemove", (e) => {
		const pos = lastMousePosition();
		if (!pos) return;
		const dx = e.clientX - pos;
		setLastMousePosition(e.clientX);
		props.setWidth(dx);
	});

	return (
		<div
			ref={ref}
			class="z-20 absolute top-0 right-0 w-[5px] cursor-col-resize select-none hover:border-r-2 hover:border-blue-400"
			classList={{
				"border-r-2 border-blue-400": lastMousePosition() !== undefined,
			}}
			style={{
				height: `${props.tableHeight}px`,
			}}
			onMouseDown={(e) => setLastMousePosition(e.clientX)}
			onDblClick={props.onDblClick}
		/>
	);
}

function BulkExportButton(props: {
	data: any[];
	columns: [string, ColumnDefinitions<any>][];
}) {
	const download = (name: string, contentType: string, data: string) => {
		const link = document.createElement("a");
		link.setAttribute(
			"href",
			encodeURI(`data:${contentType};charset=utf-8,${data}`),
		);
		link.setAttribute("download", name);
		document.body.appendChild(link); // Required for FF
		link.click();
	};

	const exportCsv = () => {
		let result = `${props.columns.map(([_, column]) => column.header).join(",")}\n`; // TODO: Might be JSX which will break this

		for (const row of props.data) {
			for (const [key, _] of props.columns) {
				let cell = entities[row.type].columns[key]?.raw(row.data);
				if (cell === undefined) cell = "";

				result = `${result}${cell},`;
			}
			result = `${result}\n`;
		}

		download("export.csv", "text/csv", result);
	};

	const exportJson = () => {
		const result = [];
		for (const row of props.data) {
			result.push(
				props.columns.map(([key, _]) =>
					entities[row.type].columns[key]?.raw(row.data),
				),
			);
		}

		download(
			"export.json",
			"application/json",
			JSON.stringify(result, null, 2),
		);
	};

	return (
		<DropdownMenu>
			<DropdownMenuTrigger as={Button} variant="ghost">
				Export
			</DropdownMenuTrigger>
			<DropdownMenuContent>
				<DropdownMenuItem onClick={exportCsv}>CSV</DropdownMenuItem>
				<DropdownMenuItem onClick={exportJson}>JSON</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
