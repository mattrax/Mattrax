import type { DeepKeys, FieldApi, FormApi } from "@tanstack/solid-form";
import {
	type Accessor,
	type Component,
	type ComponentProps,
	type JSX,
	createUniqueId,
	splitProps,
} from "solid-js";

import clsx from "clsx";
import type { SolidFormOutput } from ".";
import { Label, Select } from "..";

type DistributiveOmit<T, K extends keyof any> = T extends any
	? Omit<T, K>
	: never;

export function SelectField<
	TData extends Record<string, any>,
	TName extends DeepKeys<TData>,
>(
	props: DistributiveOmit<
		ComponentProps<typeof Select<TData[TName]>>,
		"id" | "value" | "onChange" | "onBlur" | "form"
	> & {
		form: SolidFormOutput<TData, any>;
		fieldClass?: string;
		name: TName;
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
					<Select
						{...(selectProps as any)}
						id={id}
						value={field().state.value}
						onChange={(e) => field().handleChange(e as any)}
						onBlur={() => field().handleBlur()}
					/>
				</div>
			)}
		</form.Field>
	);
}
