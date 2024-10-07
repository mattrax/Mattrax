import { Dialog as KDialog } from "@kobalte/core";
import type { JSX } from "solid-js";
import { createStore } from "solid-js/store";
import { z } from "zod";

import {
	Button,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogRoot,
	DialogTitle,
} from "@mattrax/ui";
import { Form, InputField, createForm } from "@mattrax/ui/forms";

export type ConfirmDialogState = {
	title: string;
	action: string;
	description?: () => JSX.Element;
	inputText?: string;
	closeButton?: JSX.Element;
	onConfirm?: () => Promise<void> | void;
	open: boolean;
};
export interface ConfirmDialogProps {
	children: (
		confirm: (state: Omit<ConfirmDialogState, "open">) => Promise<boolean>,
	) => JSX.Element;
}

function createDefaultState(): ConfirmDialogState {
	return {
		title: "",
		action: "",
		open: false,
	};
}

/**
 * A dialog that asks the user to enter some specific text before proceeding with an action.
 */
export function ConfirmDialog(props: ConfirmDialogProps) {
	const [state, setState] = createStore<ConfirmDialogState>(
		createDefaultState(),
	);

	let res: ((v: boolean) => void) | undefined;
	const form = createForm({
		schema() {
			let schema = z.object({ input: z.string() });
			if (state.inputText === undefined) schema = z.object({}) as any;

			return schema;
		},
		async onSubmit() {
			await state.onConfirm?.();
			setState("open", false);
			res?.(true);
		},
	});

	return (
		<DialogRoot
			open={state.open}
			setOpen={(o) => {
				if (!o) {
					setState("open", false);
					res?.(false);
				}
			}}
		>
			{props.children((state) => {
				form.reset();
				setState({ ...createDefaultState(), ...state, open: true });
				return new Promise<boolean>((r) => {
					res = r;
				});
			})}
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{state.title}</DialogTitle>
					{state.description && (
						<DialogDescription>{state.description()}</DialogDescription>
					)}
				</DialogHeader>

				{state.inputText && (
					<p class="text-muted-foreground text-sm">
						To confirm, type <b>{state.inputText}</b> in the box below
					</p>
				)}

				<Form form={form} guardBeforeLeave={false}>
					<div class="space-y-4">
						{state.inputText !== undefined && (
							<InputField form={form} name="input" />
						)}

						<DialogFooter>
							{state.closeButton === undefined ? (
								<KDialog.CloseButton as={Button} variant="outline">
									Cancel
								</KDialog.CloseButton>
							) : (
								state.closeButton
							)}

							<Button
								type="submit"
								variant="destructive"
								disabled={
									state.inputText !== undefined &&
									form.data.input !== state.inputText
								}
							>
								{state.action}
							</Button>
						</DialogFooter>
					</div>
				</Form>
			</DialogContent>
		</DialogRoot>
	);
}
