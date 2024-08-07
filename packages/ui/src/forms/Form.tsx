import { useBeforeLeave } from "@solidjs/router";
import { type FormOptions, createForm } from "@tanstack/solid-form";
import { zodValidator } from "@tanstack/zod-form-adapter";
import {
	type ComponentProps,
	createEffect,
	createMemo,
	splitProps,
} from "solid-js";
import type { z } from "zod";

export function createZodForm<S extends z.ZodSchema<any, z.ZodObjectDef, any>>(
	opts: Omit<
		FormOptions<z.infer<S>, ReturnType<typeof zodValidator>>,
		"validatorAdapter" | "defaultValues"
	> & {
		schema: S;
		defaultValues?: z.infer<S> | (() => z.infer<S>);
	},
) {
	const form = createForm(
		createMemo(() => ({
			...opts,
			defaultValues:
				typeof opts.defaultValues === "function"
					? (undefined as any as S)
					: opts.defaultValues,
			validatorAdapter: zodValidator(),
			validators: {
				onSubmit: opts.schema,
			},
		})),
	);

	createEffect(() => {
		if (typeof opts.defaultValues !== "function") return;
		// @ts-expect-error: checked on last line
		const defaultValues = opts.defaultValues();

		for (const key in defaultValues) {
			if (form.getFieldInfo(key as any).instance?.state.meta.isDirty !== true)
				form.setFieldValue(key as any, defaultValues[key]);
		}
	});

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
