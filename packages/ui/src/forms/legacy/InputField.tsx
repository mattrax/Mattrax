import type { DeepKeys, FieldComponent } from "@tanstack/solid-form";
import {
	type ComponentProps,
	type JSX,
	createSignal,
	createUniqueId,
	splitProps,
} from "solid-js";

import clsx from "clsx";
import { z } from "zod";
import type { SolidFormOutput } from ".";
import { Input, Label } from "../..";

export function InputField<
	TData extends Record<string, any>,
	TName extends DeepKeys<TData>,
>(
	props: Omit<
		ComponentProps<typeof Input>,
		"id" | "value" | "onInput" | "onBlur" | "form"
	> & {
		form: SolidFormOutput<TData, any>;
		fieldClass?: string;
		name: TName;
		label?: JSX.Element;
		labelClasses?: string;
		onInput?: (
			e: InputEvent & {
				currentTarget: HTMLInputElement;
				target: HTMLInputElement;
			},
		) => void;
		fieldProps?: Omit<
			ComponentProps<FieldComponent<TData>>,
			"children" | "name" | "validatorAdapter"
		>;
	},
) {
	const [_, inputProps] = splitProps(props, [
		"form",
		"name",
		"label",
		"labelClasses",
		"fieldClass",
	]);
	const id = createUniqueId();
	const isSubmitting = props.form.useStore((state) => state.isSubmitting);

	const getValidationSchema = (key: string) => {
		// @ts-expect-error
		const validator = props.form.options.validators?.theSchema;
		if (!validator) return;
		if (!(validator instanceof z.ZodObject))
			throw new Error("Form validator is not an object!");
		return validator.shape[key];
	};

	// const [hasChanged, setHasChanged] = createSignal(false);
	return (
		<props.form.Field
			name={props.name}
			// Due to the form-level validation not correlating fields, we do this
			// This could be replaced by this once merged: https://github.com/TanStack/form/pull/656
			validators={{
				// TODO: We probs also need `onMount`???
				onBlur: getValidationSchema(props.name),
				onChange: getValidationSchema(props.name),
			}}
			// This is casted to any to workaround: https://github.com/TanStack/form/issues/891
			{...(props.fieldProps as any)}
		>
			{(field) => (
				<div class={clsx("flex flex-col space-y-1.5", props.fieldClass)}>
					{props.label && (
						<Label for={id} class={props.labelClasses}>
							{props.label}
						</Label>
					)}
					<Input
						{...inputProps}
						id={id}
						value={field().state.value as any}
						onFocus={() => {
							if (
								field().state.value !==
									(props.form.options.defaultValues?.[props.name] || "") &&
								field().state.meta.isTouched
							)
								field().setMeta((m) => ({ ...m, hideError: true }));
						}}
						onFocusOut={() =>
							field().setMeta((m) => ({ ...m, hideError: false }))
						}
						onInput={(e) => {
							if ("onInput" in props) props.onInput?.(e);
							field().handleChange(e.currentTarget.value as any);
						}}
						onBlur={() => field().handleBlur()}
						// This is a workaround to prevent the browser from asking to save the passwords
						readOnly={
							props.autocomplete === "off" && isSubmitting()
								? true
								: props.readOnly
						}
					/>
				</div>
			)}
		</props.form.Field>
	);
}
