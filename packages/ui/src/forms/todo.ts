import { createEffect } from "solid-js";
import { createMutable } from "solid-js/store";
import type { z } from "zod";

export type FormState<T> = {
	fields: {
		[K in keyof T]?: {
			value: T[K];
			meta: {
				isDirty: boolean;
				error?: string;
			};
		};
	};
	isValid: boolean;
	isSubmitting: boolean;
	onSubmit: (data: T) => Promise<void> | void;
};

export type CreateFormProps<S extends z.AnyZodObject> = {
	schema: S;
	defaultValues?: () => Partial<z.infer<S>>;
	onSubmit?: (data: z.infer<S>) => Promise<void> | void;
};

export function createForm2<S extends z.AnyZodObject>(
	props: CreateFormProps<S>,
) {
	const state = createMutable<FormState<z.infer<S>>>({
		fields: Object.fromEntries(
			Object.entries(props.defaultValues?.() || {}).map(([key, value]) => [
				key,
				{
					value,
					meta: {
						isDirty: false,
						error: undefined, // TODO: Run validation on load???
					},
				},
			]),
		),
		isSubmitting: false,
		isValid: false,
		onSubmit() {
			if (this.isSubmitting) return;
			this.isSubmitting = true;

			const result = props.schema.safeParse(this.fields);
			if (!result.success) throw new Error("Invalid form data"); // TODO: How to handle this?

			Promise.resolve(props.onSubmit?.(result.data))
				.then(() => {
					this.isSubmitting = false;
				})
				.catch((err) => {
					this.isSubmitting = false;
					return err;
				});
		},
	});

	// TODO: Sync default values if field not dirty
	console.log("A");
	createEffect(() => {
		console.log("B");
	});
	console.log("C");

	// TODO: Derive `isValid`, running validation when required
	// TODO: Async validation?

	return state;
}
