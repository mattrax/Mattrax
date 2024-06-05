import {
	AsyncButton,
	Badge,
	Button,
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
	Tabs,
	TabsIndicator,
	TabsList,
	TabsTrigger,
} from "@mattrax/ui";
import type { CreateQueryResult } from "@tanstack/solid-query";
import { createColumnHelper } from "@tanstack/solid-table";
import {
	Index,
	type ParentProps,
	Show,
	Suspense,
	createSignal,
} from "solid-js";

import { A } from "@solidjs/router";
import { toTitleCase } from "~/lib/utils";
import { ConfirmDialog } from "~c/ConfirmDialog";
import {
	FloatingSelectionBar,
	StandardTable,
	createStandardTable,
	selectCheckboxColumn,
} from "~c/StandardTable";

const columnHelper = createColumnHelper<{
	pk: number;
	id: string;
	name: string;
	variant: string;
}>();

export const createVariantTableColumns = (variants?: VariantTableVariants) => [
	selectCheckboxColumn,
	columnHelper.accessor("name", {
		header: "Name",
		cell: (props) => (
			<Show
				when={variants?.[props.row.original.variant]?.href}
				fallback={props.getValue()}
				keyed
			>
				{(href) => (
					<A
						class="font-medium hover:underline focus:underline p-1 -m-1 w-full block"
						href={href(props.row.original)}
					>
						{props.getValue()}
					</A>
				)}
			</Show>
		),
	}),
	columnHelper.accessor("variant", {
		header: "Variant",
		id: "variant",
		cell: (info) => <Badge>{toTitleCase(info.getValue())}</Badge>,
		size: 1,
	}),
];

export type VariantTableItem = { pk: number; name: string; id: string };

export type VariantTableVariant = {
	label: string;
	query: CreateQueryResult<Array<VariantTableItem> | undefined, any>;
	href?: (item: VariantTableItem) => string;
};
export type VariantTableVariants = Record<string, VariantTableVariant>;

export function VariantTableSheet<T extends VariantTableVariants>(
	props: ParentProps<{
		title: string;
		getSubmitText(count: number): string;
		description?: string;
		variants: T;
		onSubmit(items: Array<{ variant: keyof T; pk: number }>): Promise<void>;
	}>,
) {
	const [open, setOpen] = createSignal(false);

	const possibleMembers = () => {
		return Object.entries(props.variants)
			.flatMap(([value, { query }]) =>
				(query.data ?? []).map((d) => ({
					...d,
					variant: value,
				})),
			)
			.sort((a, b) => a.name.localeCompare(b.name));
	};

	const table = createStandardTable({
		get data() {
			return possibleMembers();
		},
		columns: createVariantTableColumns(props.variants),
	});

	return (
		<ConfirmDialog>
			{(confirm) => (
				<Sheet
					open={open()}
					onOpenChange={async (o) => {
						if (o) table.resetRowSelection(true);

						if (
							o === false &&
							table.getIsSomeRowsSelected() &&
							!(await confirm({
								title: "Are You Sure?",
								description: () => "You still have members selected",
								action: "Continue",
							}))
						)
							return;

						setOpen(o);
					}}
				>
					{props.children}
					<SheetContent
						transparent
						size="lg"
						class="overflow-y-auto flex flex-col"
					>
						<SheetHeader>
							<SheetTitle>{props.title}</SheetTitle>
							{props.description && (
								<SheetDescription>{props.description}</SheetDescription>
							)}
						</SheetHeader>
						<div class="flex flex-row justify-between w-full items-center my-4">
							<Tabs
								value={
									(table.getColumn("variant")!.getFilterValue() as
										| string
										| undefined) ?? "all"
								}
								onChange={(t) =>
									table
										.getColumn("variant")!
										.setFilterValue(t === "all" ? undefined : t)
								}
							>
								<TabsList>
									<Index
										each={[
											{ value: "all", display: "All" },
											...Object.entries(props.variants).map(
												([value, { label: multiple }]) => ({
													value,
													display: multiple,
												}),
											),
										]}
									>
										{(props) => (
											<TabsTrigger value={props().value}>
												{props().display}
											</TabsTrigger>
										)}
									</Index>
								</TabsList>
							</Tabs>
							<Suspense fallback={<Button disabled>Loading...</Button>}>
								<AsyncButton
									disabled={!table.getSelectedRowModel().rows.length}
									onClick={() =>
										props
											.onSubmit(
												table.getSelectedRowModel().rows.map((row) => ({
													pk: row.original.pk,
													variant: row.original.variant,
												})),
											)
											.then(() => {
												setOpen(false);
											})
									}
								>
									{props.getSubmitText(table.getSelectedRowModel().rows.length)}
								</AsyncButton>
							</Suspense>
						</div>
						<Suspense>
							<StandardTable table={table} />
						</Suspense>
					</SheetContent>
				</Sheet>
			)}
		</ConfirmDialog>
	);
}
