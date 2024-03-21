import { useBeforeLeave } from "@solidjs/router";
import { type FormOptions, createForm } from "@tanstack/solid-form";
import { zodValidator } from "@tanstack/zod-form-adapter";
import { type ComponentProps, createMemo, splitProps } from "solid-js";
import type { z } from "zod";

export function createZodForm<S extends z.ZodSchema>(
	opts: Omit<
		FormOptions<z.infer<S>, typeof zodValidator>,
		"validatorAdapter"
	> & {
		schema: S;
	},
) {
	const form = createForm(
		createMemo(() => ({
			...opts,
			validatorAdapter: zodValidator,
			validators: {
				onSubmit: opts.schema,
			},
		})),
	);

	return form;
}

export type FormProps<S extends z.ZodSchema> = Omit<
	ComponentProps<"form">,
	"onSubmit"
> & {
	form: ReturnType<typeof createZodForm<S>>;
	fieldsetClass?: string;
	/** @defaultValue `true` */
	guardBeforeLeave?: boolean;
};

export function Form<S extends z.ZodSchema>(props: FormProps<S>) {
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
					<fieldset disabled={state().isSubmitting} class={props.fieldsetClass}>
						{props.children}
					</fieldset>
				)}
			</props.form.Subscribe>
		</form>
	);
}
