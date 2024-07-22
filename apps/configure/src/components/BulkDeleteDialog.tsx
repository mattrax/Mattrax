/// Coped from `@mattrax/web` we should probs break out and share?

import { Dialog } from "@kobalte/core/dialog";
import {
	AsyncButton,
	Button,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogRoot,
	DialogTitle,
} from "@mattrax/ui";
import type { Row, Table } from "@tanstack/solid-table";
import { type Accessor, type JSX, createSignal } from "solid-js";

export function createBulkDeleteDialog<TData>(props: {
	table: Table<TData>;
	onDelete: (data: Array<TData>) => any;
}) {
	const [state, setState] = createSignal<{
		open: boolean;
		rows: Array<Row<TData>>;
	}>({ open: false, rows: [] });

	return Object.assign(props, {
		get state() {
			return state;
		},
		show: (rows: Array<Row<TData>>) => {
			setState({ open: true, rows });
		},
		setState,
	});
}

export function BulkDeleteDialog<TData>(props: {
	dialog: ReturnType<typeof createBulkDeleteDialog<TData>>;
	title: (_: {
		count: Accessor<number>;
		rows: Accessor<Array<Row<TData>>>;
	}) => JSX.Element;
	description?: (_: {
		count: Accessor<number>;
		rows: Accessor<Array<Row<TData>>>;
	}) => JSX.Element;
}) {
	const renderingProps = {
		count: () => props.dialog.state().rows.length,
		rows: () => props.dialog.state().rows,
	};

	return (
		<DialogRoot
			open={props.dialog.state().open}
			onOpenChange={(o) => {
				if (!o) props.dialog.setState((s) => ({ ...s, open: false }));
			}}
		>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{props.title(renderingProps)}</DialogTitle>
					{props.description && (
						<DialogDescription>
							{props.description(renderingProps)}
						</DialogDescription>
					)}
				</DialogHeader>
				<DialogFooter>
					<Dialog.CloseButton as={Button} variant="secondary">
						Cancel
					</Dialog.CloseButton>
					<div class="flex-1" />
					<AsyncButton
						onClick={async () => {
							await props.dialog.onDelete(
								props.dialog.state().rows.map((r) => r.original),
							);

							props.dialog.table.resetRowSelection(true);
							props.dialog.setState((s) => ({ ...s, open: false }));
						}}
						variant="destructive"
					>
						Confirm
					</AsyncButton>
				</DialogFooter>
			</DialogContent>
		</DialogRoot>
	);
}
