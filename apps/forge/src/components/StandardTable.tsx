import {
	ColumnDef,
	PartialKeys,
	RowData,
	type Table as TTable,
	TableOptions,
	createSolidTable,
	flexRender,
	getCoreRowModel,
	getPaginationRowModel,
} from "@tanstack/solid-table";
import clsx from "clsx";
import { For, ParentProps, createEffect, mergeProps, on } from "solid-js";

export function createStandardTable<TData extends RowData>(
	options: Omit<
		PartialKeys<TableOptions<TData>, "getCoreRowModel">,
		"getPaginationRowModle"
	> & { pagination?: boolean },
) {
	return createSolidTable(
		mergeProps(
			{
				getCoreRowModel: getCoreRowModel(),
				defaultColumn: mergeProps(
					{ size: "auto" as unknown as number },
					options.defaultColumn,
				),
				...(options.pagination && {
					getPaginationRowModel: getPaginationRowModel(),
				}),
			} satisfies Partial<TableOptions<TData>>,
			options,
		),
	);
}

export function createSearchParamPagination<TData extends RowData>(
	table: TTable<TData>,
	key: string,
) {
	const [searchParams, setSearchParams] = useSearchParams();

	const pageParam = createMemo(() => {
		const parsed = z.coerce.number().safeParse(searchParams[key]);

		if (parsed.success) return parsed.data;
		return 0;
	});

	createEffect(
		on(
			() => table.getState().pagination.pageIndex,
			(index) =>
				setSearchParams({ [key]: index || undefined }, { replace: true }),
		),
	);

	createEffect(
		on(pageParam, (page) => {
			table.setPageIndex(page);
		}),
	);
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
} from "./ui";

export function StandardTable<TData>(props: {
	table: TTable<TData>;
	class?: string;
}) {
	const numCols = () =>
		props.table
			.getHeaderGroups()
			.map((c) => c.headers.length)
			.reduce((a, b) => a + b);

	return (
		<>
			<div class={clsx("rounded-md border", props.class)}>
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
						{props.table.getRowModel().rows.length ? (
							<For each={props.table.getRowModel().rows}>
								{(row) => (
									<TableRow data-state={row.getIsSelected() && "selected"}>
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

import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from "./ui";
import { useSearchParams } from "@solidjs/router";
import { useZodParams } from "~/lib/useZodParams";
import { z } from "zod";
import { createMemo } from "solid-js";

export function ColumnsDropdown<TData>(
	props: ParentProps & { table: TTable<TData> },
) {
	return (
		<DropdownMenu placement="bottom-end">
			<DropdownMenuTrigger asChild>{props.children}</DropdownMenuTrigger>
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
							{column.id.split(/(?=[A-Z])/).join(" ")}
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
