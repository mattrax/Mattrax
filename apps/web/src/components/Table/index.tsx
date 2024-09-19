import { createEscapeKeyDown } from "@kobalte/core";
import {
	Button,
	Checkbox,
	Input,
	Popover,
	PopoverContent,
	PopoverTrigger,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@mattrax/ui";
import { For, Show, batch, createEffect, createMemo } from "solid-js";
import { z } from "zod";
import { useZodQueryParams } from "~/lib/useZodParams";
import type { Filter, TableDefinition } from "./definition";
import { Selected } from "./selected";

export * from "./definition";

// TODO: Maybe rename cause this overlaps with `@mattrax/ui`
// TODO: Column resizing

type TableProps<T> = {
	def: TableDefinition<T>;
	data: T[] | undefined;
};

export function Table<T>(props: TableProps<T>) {
	const [query, setQuery] = useZodQueryParams({
		query: z.string().optional(),
		orderBy: z.string().optional(),
		desc: z.coerce.boolean().optional(),
		columns: z.string().optional(),
	});
	const selected = new Selected(() => props.data?.length || 0);

	// TODO: Handle `orderBy` pointing to a non-existent column
	// TODO: Remove non-existent columns from `columns`

	// TODO: This will probs trigger full-component suspense
	const data = createMemo(() => {
		if (!props.data) return [];
		if (query.query === undefined) return props.data;

		const search = props.def.search;
		if (search === undefined) {
			setQuery({ query: undefined });
			return props.data;
		}

		// TODO: Ordering, orderBy
		// TODO: Better search
		const cleanedQuery = query.query.trim().toLowerCase();
		return props.data
			.map((row) => [search(row, cleanedQuery), row] as const)
			.filter((r) => r[0] > 0.15)
			.sort((a, b) => b[0] - a[0])
			.map((r) => r[1]);
	});

	// TODO: Clear all selections to data outside of the current search
	createEffect(() => {
		// for (const s of selected.getSelected()) {
		// 	if (data.fin)
		// 	// if (selected >= data().length) selected.deselect(selected);
		// }
	});

	const enabledColumns = createMemo(() => {
		const columns = Object.keys(props.def.columns);
		if (query.columns === undefined) return columns;
		if (query.columns === ",") return [];
		return query.columns.split(",").filter((c) => columns.includes(c));
	});

	return (
		<div class="space-y-4 w-full">
			<FilterBar
				def={props.def}
				dataCount={data().length}
				selectedCount={selected.selectedCount()}
				search={query.query ?? ""}
				setSearch={(s) => setQuery({ query: s === "" ? undefined : s })}
				orderBy={query.orderBy ?? Object.keys(props.def.columns)?.[0]}
				setOrderBy={(c) =>
					setQuery({
						orderBy: c === Object.keys(props.def.columns)?.[0] ? undefined : c,
					})
				}
				asc={query.desc !== true}
				toggleOrdering={() => {
					if (query.desc) setQuery({ desc: undefined });
					else setQuery({ desc: true });
				}}
				columns={enabledColumns()}
				toggleColumnVisible={(c) => {
					const columns = Object.keys(props.def.columns);

					let result: string[];
					if (enabledColumns().includes(c)) {
						result = enabledColumns().filter((id) => id !== c);
					} else {
						result = [...enabledColumns(), c];
					}

					setQuery({
						columns: columns.every((c) => result.includes(c))
							? undefined
							: result.length === 0
								? ","
								: result.sort().join(","),
					});
				}}
				resetToDefault={() =>
					setQuery({ desc: undefined, orderBy: undefined, columns: undefined })
				}
			/>
			<div class="rounded-md border">
				<div class="relative w-full overflow-auto">
					<table class="w-full caption-bottom text-sm">
						<TableHead
							def={props.def}
							enabledColumns={enabledColumns()}
							selected={selected}
						/>
						<tbody class="[&amp;_tr:last-child]:border-0">
							{/* // TODO: Suspense */}
							<For each={data()}>
								{(row, i) => (
									<TableRow
										def={props.def}
										data={data()}
										enabledColumns={enabledColumns()}
										row={row}
										index={i()}
										selected={selected}
									/>
								)}
							</For>
						</tbody>
					</table>
				</div>
			</div>
			<Show when={selected.selectedCount() > 0}>
				{(_) => {
					createEscapeKeyDown({
						onEscapeKeyDown: () => selected.clear(),
					});

					return (
						<div class="animate-in fade-in slide-in-from-bottom-2 zoom-in-[0.98] bottom-6 inset-x-0 fixed flex flex-row justify-center pointer-events-none">
							<div class="p-2 rounded-lg bg-white border border-gray-100 text-sm flex flex-row items-stretch gap-2 pointer-events-auto shadow">
								<div class="flex flex-row items-center gap-1.5 ml-2">
									<span class="font-medium">
										{selected.selectedCount()} Selected
									</span>
									<Button
										variant="ghost"
										size="iconSmall"
										onClick={() => selected.clear()}
									>
										<IconPhXBold class="w-4 h-4" />
									</Button>
								</div>
								<For each={Object.values(props.def.bulkActions || {})}>
									{(action) => action()}
								</For>
							</div>
						</div>
					);
				}}
			</Show>
		</div>
	);
}

function FilterBar<T>(props: {
	def: TableDefinition<T>;
	dataCount: number;
	selectedCount: number;
	search: string;
	setSearch: (s: string) => void;
	orderBy?: string;
	setOrderBy: (column: string) => void;
	asc: boolean;
	columns: string[];
	toggleColumnVisible: (column: string) => void;
	toggleOrdering: () => void;
	resetToDefault: () => void;
}) {
	return (
		<div class="flex items-center justify-between w-full">
			<div class="flex flex-1 items-center space-x-2">
				<Input
					placeholder="Search..."
					value={props.search}
					onInput={(v) => props.setSearch(v.currentTarget.value)}
					class="h-8 w-[150px] lg:w-[250px]"
				/>
				<p class="text-sm text-zinc-500">
					<Show
						when={props.selectedCount > 0}
						fallback={<>Found {props.dataCount} records</>}
					>
						Selected {props.selectedCount} of {props.dataCount} records
					</Show>
				</p>
				<div class="flex-1" />
				<For each={Object.values(props.def.filters || {})}>
					{(filter) => renderFilter(filter)}
				</For>

				<Popover>
					<PopoverTrigger
						as="button"
						class="items-center justify-center whitespace-nowrap font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground rounded-md px-3 text-xs ml-auto hidden h-8 lg:flex"
					>
						<IconRadixIconsMixerHorizontal class="mr-1" />
						View
					</PopoverTrigger>
					<PopoverContent class="p-4 flex flex-col space-y-4 w-[280px]">
						<div class="flex items-center space-x-2">
							<p class="text-sm text-zinc-500 mr-auto">Ordering</p>
							<Select
								value={props.orderBy}
								disabled={!props.orderBy}
								onChange={(v) => props.setOrderBy(v!)}
								options={Object.keys(props.def.columns)}
								itemComponent={(p) => (
									<SelectItem item={p.item}>
										{props.def.columns[p.item.rawValue]?.title}
									</SelectItem>
								)}
							>
								<SelectTrigger
									aria-label="Column to order by"
									class="!h-8 !text-xs break-keep"
								>
									<SelectValue<string>>
										{(state) =>
											props.def.columns[state.selectedOption()]?.title
										}
									</SelectValue>
								</SelectTrigger>
								<SelectContent />
							</Select>
							<Button
								variant="outline"
								aria-label="Direction"
								class="!h-8 !px-2"
								onClick={props.toggleOrdering}
							>
								<Show
									when={props.asc}
									fallback={<IconPhSortDescending aria-label="Descending" />}
								>
									<IconPhSortAscending aria-label="Ascending" />
								</Show>
							</Button>
						</div>

						<div class="flex flex-wrap">
							<For each={Object.entries(props.def.columns)}>
								{([key, column]) => (
									<Button
										variant="outline"
										class="!h-8 !text-sm !font-normal !px-1 m-1"
										classList={{
											"opacity-60": !props.columns.includes(key),
										}}
										onClick={() => props.toggleColumnVisible(key)}
									>
										{column.title}
									</Button>
								)}
							</For>
						</div>

						<Button onClick={props.resetToDefault} class="!h-8">
							Reset to default
						</Button>
					</PopoverContent>
				</Popover>
			</div>
		</div>
	);
}

function renderFilter<T>(filter: Filter<T>) {
	// TODO: Show what filters are active somewhere

	// TODO: Apply filters to URL

	return (
		<Select
			value={[]}
			onChange={() => alert("TODO")}
			options={Object.keys(filter.options)}
			placeholder={`Filter by ${filter.title}...`}
			itemComponent={(props) => (
				<SelectItem item={props.item}>
					{filter.options[props.item.key]}
				</SelectItem>
			)}
			multiple
		>
			<SelectTrigger
				as="button"
				type="button"
				class="inline-flex items-center justify-center whitespace-nowrap font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground rounded-md px-3 text-xs h-8 border-dashed"
			>
				<span class="mr-1">
					<filter.icon />
				</span>
				{filter.title}
			</SelectTrigger>
			<SelectContent />
		</Select>
	);
}

function TableHead<T>(props: {
	def: TableDefinition<T>;
	enabledColumns: string[];
	selected: Selected<number>;
}) {
	return (
		<thead class="[&amp;_tr]:border-b">
			<tr class="border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted">
				<th
					class="h-10 px-2 text-left align-middle font-medium text-muted-foreground [&amp;:has([role=checkbox])]:pr-0 [&amp;>[role=checkbox]]:translate-y-[2px]"
					colspan="1"
				>
					<Checkbox
						checked={props.selected.isAllSelected()}
						indeterminate={props.selected.isIndeterminate()}
						onChange={(value) =>
							batch(() => {
								if (value) props.selected.selectAll();
								else props.selected.clear();
							})
						}
						aria-label="Select all"
					/>
				</th>
				<For
					each={Object.entries(props.def.columns).filter((c) =>
						props.enabledColumns.includes(c[0]),
					)}
				>
					{([, column]) => (
						<th
							class="h-10 px-2 text-left align-middle font-medium text-muted-foreground [&amp;:has([role=checkbox])]:pr-0 [&amp;>[role=checkbox]]:translate-y-[2px]"
							colspan="1"
						>
							{column.title}
						</th>
					)}
				</For>
			</tr>
		</thead>
	);
}

function TableRow<T>(
	props: TableProps<T> & {
		index: number;
		row: T;
		enabledColumns: string[];
		selected: Selected<number>;
	},
) {
	return (
		<tr
			class="border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted"
			data-state="false"
		>
			<td class="p-2 align-middle [&amp;:has([role=checkbox])]:pr-0 [&amp;>[role=checkbox]]:translate-y-[2px]">
				<Checkbox
					checked={props.selected.isSelected(props.index)}
					onChange={(v) => {
						if (v) props.selected.select(props.index);
						else props.selected.deselect(props.index);
					}}
					aria-label="Select row"
				/>
			</td>
			<For
				each={Object.entries(props.def.columns).filter((c) =>
					props.enabledColumns.includes(c[0]),
				)}
			>
				{([, column]) => (
					<th
						class="h-10 px-2 text-left align-middle font-medium text-muted-foreground [&amp;:has([role=checkbox])]:pr-0 [&amp;>[role=checkbox]]:translate-y-[2px]"
						colspan="1"
					>
						{column.render(props.row)}
					</th>
				)}
			</For>
		</tr>
	);
}
