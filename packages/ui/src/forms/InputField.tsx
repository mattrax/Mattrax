import { DeepKeys, FieldApi, FormApi } from "@tanstack/solid-form";
import {
	Accessor,
	Component,
	ComponentProps,
	JSX,
	createUniqueId,
	splitProps,
} from "solid-js";

import { clsx } from "clsx";
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

	const form = {
		get Field() {
			return props.form.Field as unknown as Component<{
				name: TName;
				children: (field: Accessor<FieldApi<TData, TName>>) => JSX.Element;
			}>;
		},
	};

	return (
		<form.Field name={props.name}>
			{(field) => (
				<div class={clsx("flex flex-col space-y-1.5", props.fieldClass)}>
					{props.label !== undefined && (
						<Label for={id} class={props.labelClasses}>
							{props.label}
						</Label>
					)}
					<Input
						{...inputProps}
						id={id}
						value={field().state.value}
						onInput={(e) => field().handleChange(e.currentTarget.value as any)}
						onBlur={() => field().handleBlur()}
					/>
				</div>
			)}
		</form.Field>
	);
}
