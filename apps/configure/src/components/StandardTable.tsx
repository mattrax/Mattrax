/// Copied from `@mattrax/web` we should probs break out and share?

import {
	type ColumnDef,
	type PartialKeys,
	type Row,
	type RowData,
	type Table as TTable,
	type TableOptions,
	createSolidTable,
	flexRender,
	getCoreRowModel,
	getFilteredRowModel,
	getPaginationRowModel,
	getSortedRowModel,
} from "@tanstack/solid-table";
import {
	For,
	type JSX,
	type ParentProps,
	Show,
	children,
	createEffect,
	mergeProps,
} from "solid-js";

export function createStandardTable<TData extends RowData>(
	options: Omit<
		PartialKeys<TableOptions<TData>, "getCoreRowModel">,
		| "getPaginationRowModle"
		| "getFilteredRowModel"
		| "getSortedRowModel"
		| "enableSorting"
		| "enableSortingRemoval"
	> & { pagination?: boolean },
) {
	return createSolidTable(
		mergeProps(
			{
				getCoreRowModel: getCoreRowModel(),
				getFilteredRowModel: getFilteredRowModel(),
				getSortedRowModel: getSortedRowModel(),
				defaultColumn: mergeProps(
					{ size: "auto" as unknown as number },
					options.defaultColumn,
				),
				...(options.pagination && {
					getPaginationRowModel: getPaginationRowModel(),
				}),
				enableSorting: true,
				enableSortingRemoval: true,
			} satisfies Partial<TableOptions<TData>>,
			options,
		),
	);
}

export function createSearchParamFilter<TData extends RowData>(
	table: TTable<TData>,
	column: string,
	searchParam: string,
) {
	const [searchParams] = useSearchParams();

	createEffect(() => {
		table.getColumn(column)?.setFilterValue(searchParams[searchParam]);
	});
}

import {
	Button,
	Checkbox,
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@mattrax/ui";

export function StandardTable<TData>(props: {
	table: TTable<TData>;
	rowProps?: (row: Row<TData>) => ComponentProps<typeof TableRow>;
	class?: string;
}) {
	const numCols = () =>
		props.table
			.getHeaderGroups()
			.map((c) => c.headers.length)
			.reduce((a, b) => a + b);

	return (
		<>
			<div class={props.class}>
				<Table>
					<TableHeader>
						<For each={props.table.getHeaderGroups()}>
							{(headerGroup) => (
								<TableRow>
									{headerGroup.headers.map((header) => (
										<TableHead style={{ width: `${header.getSize()}px` }}>
											{header.isPlaceholder
												? null
												: flexRender(
														header.column.columnDef.header,
														header.getContext(),
													)}
										</TableHead>
									))}
								</TableRow>
							)}
						</For>
					</TableHeader>
					<TableBody>
						{props.table.getSortedRowModel().rows.length ? (
							<For each={props.table.getSortedRowModel().rows}>
								{(row) => (
									<TableRow
										{...props.rowProps?.(row)}
										data-state={row.getIsSelected() && "selected"}
									>
										<For each={row.getVisibleCells()}>
											{(cell) => (
												<TableCell>
													{flexRender(
														cell.column.columnDef.cell,
														cell.getContext(),
													)}
												</TableCell>
											)}
										</For>
									</TableRow>
								)}
							</For>
						) : (
							<TableRow>
								<TableCell colSpan={numCols()} class="h-24 text-center">
									No results.
								</TableCell>
							</TableRow>
						)}
					</TableBody>
				</Table>
			</div>
			{props.table.options.getPaginationRowModel && (
				<StandardTablePagination table={props.table} />
			)}
		</>
	);
}

export function FloatingSelectionBar<TData>(props: {
	table: TTable<TData>;
	children?: (data: Accessor<Row<TData>[]>) => JSX.Element;
}) {
	const selectedRows = () => props.table.getSelectedRowModel().rows;

	return (
		<Show when={selectedRows().length > 0}>
			{(_) => {
				const c = children(() => props.children?.(selectedRows));

				createEscapeKeyDown({
					onEscapeKeyDown: () => props.table.resetRowSelection(true),
				});

				return (
					<div class="animate-in fade-in slide-in-from-bottom-2 zoom-in-[0.98] bottom-6 inset-x-0 fixed flex flex-row justify-center pointer-events-none">
						<div class="p-2 rounded-lg bg-white border border-gray-100 text-sm flex flex-row items-stretch gap-2 pointer-events-auto shadow">
							<div class="flex flex-row items-center gap-1.5 ml-2">
								<span class="font-medium">
									{selectedRows().length} Selected
								</span>
								<Button
									variant="ghost"
									size="iconSmall"
									onClick={() => props.table.resetRowSelection(true)}
								>
									<IconPhXBold class="w-4 h-4" />
								</Button>
							</div>
							{c() && (
								<>
									<div class="my-1 w-px bg-gray-300" />
									{c()}
								</>
							)}
						</div>
					</div>
				);
			}}
		</Show>
	);
}

export function StandardTablePagination<TData>(props: {
	table: TTable<TData>;
}) {
	return (
		<div class="flex items-center justify-end space-x-2">
			<div class="flex-1 text-sm text-muted-foreground">
				{props.table.getFilteredSelectedRowModel().rows.length} of{" "}
				{props.table.getFilteredRowModel().rows.length} row(s) selected.
			</div>
			<div class="space-x-2">
				<Button
					variant="outline"
					size="sm"
					onClick={() => props.table.previousPage()}
					disabled={!props.table.getCanPreviousPage()}
				>
					Previous
				</Button>
				<Button
					variant="outline"
					size="sm"
					onClick={() => props.table.nextPage()}
					disabled={!props.table.getCanNextPage()}
				>
					Next
				</Button>
			</div>
		</div>
	);
}

import { createEscapeKeyDown } from "@kobalte/core";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
} from "@mattrax/ui";
import { useSearchParams } from "@solidjs/router";
import type { Accessor, ComponentProps } from "solid-js";

export function ColumnsDropdown<TData>(
	props: ParentProps & {
		table: TTable<TData>;
	},
) {
	return (
		<DropdownMenu placement="bottom-end">
			{props.children}
			<DropdownMenuContent>
				<For
					each={props.table
						.getAllColumns()
						.filter((column) => column.getCanHide())}
				>
					{(column) => (
						<DropdownMenuCheckboxItem
							class="capitalize"
							checked={column.getIsVisible()}
							onChange={(value) => column.toggleVisibility(!!value)}
						>
							{(column.columnDef.header as string).split(/(?=[A-Z])/).join(" ")}
						</DropdownMenuCheckboxItem>
					)}
				</For>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

export const selectCheckboxColumn = {
	id: "select",
	header: ({ table }) => (
		<Checkbox
			class="w-4"
			checked={table.getIsAllPageRowsSelected()}
			indeterminate={table.getIsSomePageRowsSelected()}
			onChange={(value) => table.toggleAllPageRowsSelected(!!value)}
			aria-label="Select all"
		/>
	),
	cell: ({ row }) => (
		<Checkbox
			class="w-4"
			checked={row.getIsSelected()}
			onChange={(value) => row.toggleSelected(!!value)}
			aria-label="Select row"
		/>
	),
	size: 1,
	enableSorting: false,
	enableHiding: false,
} satisfies ColumnDef<any>;
