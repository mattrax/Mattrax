import {
	batch,
	children,
	createComputed,
	createMemo,
	createRoot,
	createSignal,
	untrack,
} from "solid-js";
import { createMutable } from "solid-js/store";
import { z } from "zod";
import { isLoading, latest } from "../lib"; // TODO: Bring back `latest`???

export type FormState<T> = {
	fields: {
		[K in keyof T]: FieldState<T[K]>;
	};
	isSubmitting: boolean;

	// Aliases for easily accessing state derived from fields
	data: T;
	isValid: boolean;
	isDisabled: boolean;
	isDirty: boolean;
	isTouched: boolean;

	// Should be called on the `onSubmit` event of the root `<form>` element.
	onSubmit: () => Promise<void> | void;
};

export type FieldState<T> = {
	// The current value of the field.
	value: T;
	meta: {
		// The `defaultValue` for this field.
		defaultValue: T;
		// Does this field match `defaultValue`?
		dirty: boolean;
		// Has this field been modified?
		touched: boolean;
		// Validation error
		error?: string;
	};
	// Update the field but *don't* mark it as touched.
	// This should be done for system input, for user input just assign directly to `value`.
	updateNoMeta: (value: T) => void;
};

export type CreateFormProps<S extends z.AnyZodObject> = {
	schema: () => S;
	onSubmit?: (data: z.infer<S>) => Promise<void> | void;
};

/**
 * A small but capable form library built on top of SolidJS primitives and Zod.
 *
 * Mattrax was using Tanstack Form but I run into a lot of issues with it:
 *  - https://github.com/TanStack/form/pull/909
 *  - https://github.com/TanStack/form/pull/908
 *  - https://github.com/TanStack/form/pull/907
 *  - https://github.com/TanStack/form/issues/910
 *
 * and honestly the whole idea of the field state being outside Solid's lifecycle is really annoying to work with.
 *
 * Major design decisions:
 *  - While loading async default values the form will disable all fields but *not* trigger a full suspense.
 *  - Everything is within Solid's lifecycle. No need for `const someProperty = store.useStore((state) => state.someProperty)`
 *  - Per-form schema but the validation errors are stored on a per-field level (associated with the schema).
 *  - No concept of async validation or non-Zod global form validation. Your better of handling this stuff yourself using `createAsync` w/ Solid's auto-tracking.
 *
 */
export function createForm<S extends z.AnyZodObject>(
	props: CreateFormProps<S>,
) {
	const [schema, setSchema] = createSignal(createRoot(props.schema));
	createRoot(() => createMemo(() => setSchema((_) => props.schema())));

	const state = createMutable<FormState<z.infer<S>>>({
		// State
		fields: {} as any,
		isSubmitting: false,

		// Derived state
		get isDisabled() {
			return isLoading(props.schema);
		},
		get data() {
			return Object.fromEntries(
				Object.keys(this.fields).map((key) => [key, this.fields[key]!.value]),
			) as z.infer<S>;
		},
		get isValid() {
			return Object.keys(this.fields).every(
				(key) => this.fields[key]!.meta.error === undefined,
			);
		},
		get isDirty() {
			return Object.keys(this.fields).some(
				(key) => this.fields[key]!.meta.dirty,
			);
		},
		get isTouched() {
			return Object.keys(this.fields).some(
				(key) => this.fields[key]!.meta.touched,
			);
		},

		// Actions
		onSubmit() {
			if (this.isSubmitting || this.isDisabled || !this.isValid) {
				console.warn("Form is disabled or already submitting. Skipping...");
				return;
			}
			this.isSubmitting = true;

			Promise.resolve(props.onSubmit?.(this.data))
				.then(async () => {
					this.isSubmitting = false;
				})
				.catch((err) => {
					this.isSubmitting = false;
					return err;
				});
		},
	});

	// Keep default values in sync, as long as the fields are not dirty
	createComputed(() =>
		batch(() => {
			for (const [key, def] of Object.entries(schema().shape)) {
				let value =
					def instanceof z.ZodDefault ? def._def.defaultValue() : undefined;
				if (def instanceof z.ZodString) value = "";
				if (def instanceof z.ZodNumber) value = 0;
				if (def instanceof z.ZodBoolean) value = false;
				// You *must* define a Zod default or use a type we can infer a default from.
				// Maintaining this invariant also means `state.data = z.infer<S>` is safe as opposed to `state.data = Partial<z.infer<S>>` without it.
				if (value === undefined)
					throw new Error(`Unable to determine default for field '${key}'.`);

				untrack(() => {
					if (state.fields[key as keyof S] === undefined) {
						const [v, setV] = createSignal<any>(value);

						state.fields[key as keyof S] = {
							get value() {
								return v();
							},
							set value(v: any) {
								setV(v);
								this.meta.touched = true;
							},
							meta: {
								defaultValue: value,
								error: undefined,
								get dirty() {
									return v() !== this.defaultValue;
								},
								touched: false,
							},
							updateNoMeta(value: any) {
								const touched = this.meta.touched;
								this.value = value;
								this.meta.touched = touched;
							},
						};
					} else {
						if (state.fields[key]?.meta.dirty !== true) {
							const isTouched = state.fields[key as keyof S].meta.touched;
							state.fields[key as keyof S].value = value;
							state.fields[key as keyof S].meta.touched = isTouched;
						}
						state.fields[key as keyof S].meta.defaultValue = value;
					}
				});
			}
		}),
	);

	// Schema validation
	createComputed(() => {
		const result = schema().safeParse(state.data);
		for (const key of Object.keys(state.fields)) {
			state.fields[key]!.meta.error =
				result.error?.formErrors?.fieldErrors[key]?.[0];
		}
	});

	return state;
}

export type KeysMatching<T, V> = {
	[K in keyof T]-?: T[K] extends V ? K : never;
}[keyof T];

export function Field<T, K extends keyof T>(props: {
	name: K;
	form: FormState<T>;
	children: (field: FieldState<T[K]>) => any;
}) {
	const c = children(() => {
		const f = props.form.fields[props.name];
		if (!f) {
			console.warn(`Field '${String(props.name)}' not found on form!`);
			return null;
		}
		return props.children(f);
	});

	return <>{c()}</>;
}
