import { type ComponentProps, createUniqueId, splitProps } from "solid-js";

import clsx from "clsx";
import { Label, Select } from "..";
import { Field, type FormState, type KeysMatching } from "./createForm";

type DistributiveOmit<T, K extends keyof any> = T extends any
	? Omit<T, K>
	: never;

export function SelectField<T, K extends KeysMatching<T, string>>(
	props: DistributiveOmit<
		ComponentProps<typeof Select<T[K]>>,
		"id" | "value" | "onChange" | "onBlur" | "form"
	> & {
		form: FormState<T>;
		fieldClass?: string;
		name: K;
		label?: string;
		labelClasses?: string;
	},
) {
	const [_, selectProps] = splitProps(props, [
		"form",
		"name",
		"label",
		"labelClasses",
		"fieldClass",
	]);
	const id = createUniqueId();

	return (
		<Field name={props.name} form={props.form}>
			{(field) => (
				<div class={clsx("flex flex-col space-y-1.5", props.fieldClass)}>
					{props.label !== undefined && (
						<Label for={id} class={props.labelClasses}>
							{props.label}
						</Label>
					)}
					<Select
						{...(selectProps as any)}
						id={id}
						value={field.value}
						onChange={(e) => (field.value = e as any)}
					/>
				</div>
			)}
		</Field>
	);
}
