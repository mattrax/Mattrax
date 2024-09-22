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
import { createContextProvider } from "@solid-primitives/context";
import { ReactiveSet } from "@solid-primitives/set";
import {
	For,
	type JSX,
	Show,
	batch,
	createEffect,
	createMemo,
	createSignal,
} from "solid-js";
import { useSearchParams2 } from "~/lib/useSearchParams2";
import type { Filter, TableDefinition } from "./definition";

export * from "./definition";

const [Provider, useCtx] = createContextProvider(
	(props: TableProps<unknown>) => {
		const query = useSearchParams2();
		const [lastChecked, setLastChecked] = createSignal<number | undefined>();

		const enabledColumns = createMemo(() => {
			const disabled = query?.col || [];
			if (query.col)
				query.col = query.col.filter((c) => props.def.columns[c] !== undefined);

			return Object.entries(props.def.columns).filter(
				([c]) => !disabled.includes(c),
			);
		});

		const enabledFilters = createMemo(() =>
			Object.entries(props.def.filters || {})
				.filter(([key, filter]) => (query[key] || []).length !== 0)
				.map(([key, filter]) => {
					const values = query[key]!;
					if (values.some((v) => filter.options[v] === undefined))
						query[key] = values.filter((v) => filter.options[v] !== undefined);

					return [
						key,
						values,
						(row: unknown) => filter.apply(row, values),
					] as const;
				}),
		);

		const orderBy = createMemo(() => {
			const o = query.orderBy?.filter(
				(o) => props.def.columns[o] !== undefined,
			)?.[0];
			if (o && query.orderBy!.length > 1) query.orderBy = [o];
			return o ?? Object.keys(props.def.columns)?.[0];
		});

		const asc = () => query.desc === undefined || query.desc.length === 0;

		// query.desc && query.desc.length > 0;
		// (query?.desc?.length || 0) > 0;
		createEffect(() => console.log(asc(), query?.desc?.length !== 1));

		const search = () => {
			const q = query.query?.[0];
			if (q && query.query!.length > 1) query.query = [q];
			if (q) {
				const applySearch = props.def.search;
				if (applySearch !== undefined) return [q, applySearch] as const;
				else {
					query.query = undefined;
				}
			}
		};

		const data = createMemo(() => {
			let data = props.data ?? [];

			const s = search();
			if (s) {
				const cleanedQuery = s[0].trim().toLowerCase();
				data = data
					.map((row) => [s[1](row, cleanedQuery), row] as const)
					.filter((r) => r[0] > 0.15)
					.sort((a, b) => b[0] - a[0])
					.map((r) => r[1]);
			}

			const q = query.query?.[0];
			if (q && query.query!.length > 1) query.query = [q];
			if (q) {
				const applySearch = props.def.search;
				if (applySearch !== undefined) {
				} else {
					query.query = undefined;
				}
			}

			if (enabledFilters().length > 0)
				data = data.filter((row) =>
					enabledFilters().some(([, , filter]) => filter(row)),
				);

			const order = orderBy();
			if (order)
				data = data.sort((a, b) => {
					const col = props.def.columns[order];
					if (col === undefined) return 0;
					return col.sort(a, b);
				});

			// TODO: Handle `orderBy` pointing to a non-existent column
			// TODO: Ordering

			return data;
		});

		createEffect(() => {
			// TODO: Clear all selections to data outside of the current search
			// 	// for (const s of selected.getSelected()) {
			// 	// 	if (data.fin)
			// 	// 	// if (selected >= data().length) selected.deselect(selected);
			// 	// }
		});

		return {
			data,
			def: () => props.def,
			search,
			setSearch: (q: string) => (query.query = [q]),
			enabledColumns,
			enabledFilters,
			setFilters: (filter: string, values: string[]) =>
				(query[filter] = values),
			asc,
			toggleOrdering: () => (query.desc = asc() ? undefined : ["true"]),
			orderBy,
			setOrderBy: (column: string) => {
				if (column === Object.keys(props.def.columns)?.[0])
					query.orderBy = undefined;
				else query.orderBy = [column];
			},
			toggleColumnVisible: (column: string) => {
				const c = query.col || [];
				query.col = c.includes(column)
					? c.filter((c) => c !== column)
					: [...c, column];
			},
			selected: new ReactiveSet<number>(),
			lastChecked,
			setLastChecked,
			resetToDefault: () => {
				query.col = undefined;
				query.orderBy = undefined;
				query.col = undefined;
				Object.keys(props.def.filters || {}).forEach(
					(c) => (query[c] = undefined),
				);
			},
		};
	},
	undefined!,
);

type TableProps<T> = {
	def: TableDefinition<T>;
	data: T[] | undefined;
	left?: JSX.Element;
};

export function Table<T>(props: TableProps<T>) {
	return (
		<Provider {...(props as any)}>
			<div class="space-y-4 w-full">
				<FilterBar left={props.left} />
				<div class="rounded-md border">
					<div class="relative w-full overflow-auto">
						<table class="w-full caption-bottom text-sm">
							<TableHead />
							<tbody class="[&amp;_tr:last-child]:border-0">
								<TableBody />
							</tbody>
						</table>
					</div>
				</div>
				<MultiselectBar />
			</div>
		</Provider>
	);
}

function FilterBar(props: { left?: JSX.Element }) {
	const ctx = useCtx();

	return (
		<div class="flex items-center justify-between w-full">
			<div class="flex flex-1 items-center space-x-2">
				{props.left ?? null}

				<Input
					placeholder="Search..."
					value={ctx.search()?.[0] ?? ""}
					onInput={(v) => ctx.setSearch(v.currentTarget.value)}
					class="h-8 w-[150px] lg:w-[250px]"
				/>
				<p class="text-sm text-zinc-500">
					<Show
						when={ctx.selected.size > 0}
						fallback={<>Found {ctx.data.length} records</>}
					>
						Selected {ctx.selected.size} of {ctx.data.length} records
					</Show>
				</p>

				<div class="flex-1" />
				<For each={Object.entries(ctx.def().filters || {})}>{renderFilter}</For>

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
								value={ctx.orderBy()}
								disabled={ctx.orderBy() === undefined}
								onChange={(v) => ctx.setOrderBy(v!)}
								options={Object.keys(ctx.def().columns)}
								itemComponent={(p) => (
									<SelectItem item={p.item}>
										{ctx.def().columns[p.item.rawValue]?.title}
									</SelectItem>
								)}
							>
								<SelectTrigger
									aria-label="Column to order by"
									class="!h-8 !text-xs break-keep"
								>
									<SelectValue<string>>
										{(state) =>
											ctx.def().columns[state.selectedOption()]?.title
										}
									</SelectValue>
								</SelectTrigger>
								<SelectContent />
							</Select>
							<Button
								variant="outline"
								aria-label="Direction"
								class="!h-8 !px-2"
								onClick={ctx.toggleOrdering}
							>
								{ctx.asc() ? "asc" : "desc"}
								<Show
									when={ctx.asc()}
									fallback={<IconPhSortDescending aria-label="Descending" />}
								>
									<IconPhSortAscending aria-label="Ascending" />
								</Show>
							</Button>
						</div>

						<div class="flex flex-wrap">
							<For each={Object.entries(ctx.def().columns)}>
								{([key, column]) => (
									<Button
										variant="outline"
										class="!h-8 !text-sm !font-normal !px-1 m-1"
										classList={{
											"opacity-60": !ctx
												.enabledColumns()
												.find(([c]) => c === key),
										}}
										onClick={() => ctx.toggleColumnVisible(key)}
									>
										{column.title}
									</Button>
								)}
							</For>
						</div>

						<Button onClick={() => ctx.resetToDefault()} class="!h-8">
							Reset to default
						</Button>
					</PopoverContent>
				</Popover>
			</div>
		</div>
	);
}

function renderFilter<T>([key, filter]: [string, Filter<T>]) {
	const ctx = useCtx();
	const values = () => ctx.enabledFilters().find(([k]) => k === key)?.[1] || [];

	return (
		<Select
			multiple
			disallowEmptySelection={false}
			value={values() as any}
			onChange={(v) => ctx.setFilters(key, v)}
			options={Object.keys(filter.options)}
			placeholder={`Filter by ${filter.title}...`}
			itemComponent={(props) => (
				<SelectItem item={props.item}>
					{filter.options[props.item.key]}
				</SelectItem>
			)}
		>
			<SelectTrigger
				as="button"
				type="button"
				class="inline-flex items-center justify-center whitespace-nowrap font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground rounded-md px-3 text-xs h-8"
				classList={{
					"border-dashed": values().length === 0,
				}}
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

function TableHead() {
	const ctx = useCtx();

	return (
		<thead class="[&amp;_tr]:border-b">
			<tr class="border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted">
				<th
					class="h-10 px-2 text-left align-middle font-medium text-muted-foreground [&amp;:has([role=checkbox])]:pr-0 [&amp;>[role=checkbox]]:translate-y-[2px]"
					colspan="1"
				>
					<Checkbox
						checked={
							ctx.selected.size > 0 &&
							ctx.selected.size === (ctx.data()?.length || 0)
						}
						indeterminate={
							ctx.selected.size > 0 &&
							ctx.selected.size < (ctx.data()?.length || 0)
						}
						onChange={(value) =>
							batch(() => {
								if (value) {
									for (let i = 0; i < (ctx.data()?.length || 0); i++) {
										ctx.selected.add(i);
									}
								} else {
									ctx.selected.clear();
								}
							})
						}
						aria-label="Select all"
					/>
				</th>
				<For each={ctx.enabledColumns()}>
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

function TableBody() {
	const ctx = useCtx();

	return (
		<For each={ctx.data()}>
			{(row, i) => (
				<tr
					class="border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted"
					data-state="false"
				>
					<td class="p-2 align-middle [&amp;:has([role=checkbox])]:pr-0 [&amp;>[role=checkbox]]:translate-y-[2px]">
						<Checkbox
							checked={ctx.selected.has(i())}
							onClick={(e) => {
								// TODO: Bulk deselect
								// if (e.shiftKey && ctx.lastChecked()) {
								// 	alert("TODO: Multi-select");
								// }
								// ctx.setLastChecked(i());
								// console.log(e.target.value);
								// if (e.currentTarget.checked) ctx.selected.add(i());
								// else ctx.selected.delete(i());

								if (ctx.selected.has(i())) ctx.selected.delete(i());
								else ctx.selected.add(i());
							}}
							aria-label="Select row"
						/>
					</td>
					<For each={ctx.enabledColumns()}>
						{([, column]) => (
							<th
								class="h-10 px-2 text-left align-middle font-medium text-muted-foreground [&amp;:has([role=checkbox])]:pr-0 [&amp;>[role=checkbox]]:translate-y-[2px]"
								colspan="1"
							>
								{column.render(row)}
							</th>
						)}
					</For>
				</tr>
			)}
		</For>
	);
}

function MultiselectBar() {
	const ctx = useCtx();

	return (
		<Show when={ctx.selected.size > 0}>
			{(_) => {
				createEscapeKeyDown({
					onEscapeKeyDown: () => ctx.selected.clear(),
				});

				return (
					<div class="animate-in fade-in slide-in-from-bottom-2 zoom-in-[0.98] bottom-6 inset-x-0 fixed flex flex-row justify-center pointer-events-none">
						<div class="p-2 rounded-lg bg-white border border-gray-100 text-sm flex flex-row items-stretch gap-2 pointer-events-auto shadow">
							<div class="flex flex-row items-center gap-1.5 ml-2">
								<span class="font-medium">{ctx.selected.size} Selected</span>
								<Button
									variant="ghost"
									size="iconSmall"
									onClick={() => ctx.selected.clear()}
								>
									<IconPhXBold class="w-4 h-4" />
								</Button>
							</div>
							<For each={Object.values(ctx.def().bulkActions || {})}>
								{(action) => action()}
							</For>
						</div>
					</div>
				);
			}}
		</Show>
	);
}
