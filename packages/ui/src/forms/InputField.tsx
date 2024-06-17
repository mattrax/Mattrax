import type {
	DeepKeys,
	FieldApi,
	FieldComponent,
	FormApi,
} from "@tanstack/solid-form";
import {
	type Accessor,
	type Component,
	type ComponentProps,
	type JSX,
	createUniqueId,
	splitProps,
} from "solid-js";

import clsx from "clsx";
import { Input, Label } from "..";

export function InputField<
	TData extends Record<string, any>,
	TName extends DeepKeys<TData>,
>(
	props: Omit<
		ComponentProps<typeof Input>,
		"id" | "value" | "onInput" | "onBlur" | "form"
	> & {
		form: FormApi<TData, any>;
		fieldClass?: string;
		name: TName;
		label?: string;
		labelClasses?: string;
		onInput?: (e: Event) => void;
		fieldProps?: Omit<
			ComponentProps<FieldComponent<TData>>,
			"children" | "name"
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

	return (
		<props.form.Field name={props.name} {...props.fieldProps}>
			{(field) => (
				<div class={clsx("flex flex-col space-y-1.5", props.fieldClass)}>
					{props.label && <Label for={id}>{props.label}</Label>}
					<Input
						{...inputProps}
						id={id}
						value={field().state.value as any}
						onInput={(e) => {
							if ("onInput" in props) props.onInput?.(e);
							field().handleChange(e.currentTarget.value as any);
						}}
						onBlur={() => field().handleBlur()}
					/>
				</div>
			)}
		</props.form.Field>
	);
}
