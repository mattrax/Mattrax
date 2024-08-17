import { useBeforeLeave } from "@solidjs/router";
import {
	type DeepKeys,
	type FormOptions,
	createForm,
} from "@tanstack/solid-form";
import { zodValidator } from "@tanstack/zod-form-adapter";
import { type ComponentProps, Show, createMemo, splitProps } from "solid-js";
import type { z } from "zod";
import type { SolidFormOutput } from ".";

export function createZodForm<S extends z.ZodSchema<any, z.ZodObjectDef, any>>(
	opts: () => Omit<
		FormOptions<z.infer<S>, ReturnType<typeof zodValidator>>,
		"validatorAdapter"
	> & {
		schema: S;
	},
): SolidFormOutput<z.infer<S>, ReturnType<typeof zodValidator>> {
	const form = createForm(
		createMemo(() => {
			const o = opts();
			return {
				...o,
				validatorAdapter: zodValidator(),
				validators: {
					// TODO: Reenable once: https://github.com/TanStack/form/pull/656
					// onBlur: o.schema,
					// onChange: o.schema,
					// onSubmit: o.schema,
					...({ theSchema: o.schema } as Record<string, unknown>),
				},
				// onSubmitInvalid // TODO: Focus the field
			};
		}),
	);
	return form;
}

export type FormProps<S extends z.ZodSchema<any, z.ZodObjectDef, any>> = Omit<
	ComponentProps<"form">,
	"onSubmit"
> & {
	form: ReturnType<typeof createZodForm<S>>;
	fieldsetClass?: string;
	/** @defaultValue `true` */
	guardBeforeLeave?: boolean;
};

export function Form<S extends z.ZodSchema<any, z.ZodObjectDef, any>>(
	props: FormProps<S> & { disabled?: boolean },
) {
	const [_, formProps] = splitProps(props, [
		"form",
		"guardBeforeLeave",
		"fieldsetClass",
	]);

	useBeforeLeave((e) => {
		if (!props.guardBeforeLeave) return;
		// TODO: isDirty
		if (
			props.form.state.isTouched &&
			!props.form.state.isSubmitting &&
			!e.defaultPrevented
		) {
			// preventDefault to block immediately and prompt user async
			e.preventDefault();
			setTimeout(() => {
				if (window.confirm("Discard unsaved changes - are you sure?")) {
					// user wants to proceed anyway so retry with force=true
					e.retry(true);
				}
			}, 100);
		}
	});

	return (
		<form
			{...formProps}
			onSubmit={(e) => {
				e.preventDefault();
				e.stopPropagation();
				void props.form.handleSubmit();
			}}
		>
			{/* This is a hack to trick Safari into not asking to save the password to keychain */}
			<Show when={props.autocomplete === "off"}>
				<input
					type="password"
					id="fakePassword"
					style="border: 0; width: 10px; height: 10px; background-color: red; opacity: 0; position: absolute; bottom: 0px; left: 0px"
					tabIndex="-1"
					aria-disabled="true"
				/>
			</Show>

			<props.form.Subscribe>
				{(state) => (
					<fieldset
						disabled={state().isSubmitting || props?.disabled}
						class={props.fieldsetClass}
					>
						{props.children}
					</fieldset>
				)}
			</props.form.Subscribe>
		</form>
	);
}

export function getFormError<T>(
	form: SolidFormOutput<T, any>,
	name: DeepKeys<T>,
) {
	return form.useStore((state) => {
		const meta = form.getFieldMeta(name);
		// console.log("getFormError", meta);
		// console.log(meta?.hideError, meta?.errors?.[0]); // TODO

		// We don't want to show errors `onChange` the first time the user types in it.
		// Helps to avoids "min length of X" errors when the user hasn't finished typing.
		// @ts-expect-error: This isn't an official field, it's set by the `InputField` component
		if (meta?.hideError) return;
		return meta?.errors?.[0];
	})();
}
