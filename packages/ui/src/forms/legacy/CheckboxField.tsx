import type { DeepKeys, FieldComponent } from "@tanstack/solid-form";
import { type ComponentProps, createUniqueId, splitProps } from "solid-js";

import clsx from "clsx";
import type { SolidFormOutput } from ".";
import { Checkbox, type Input, Label } from "../..";

export function CheckboxField<
	TData extends Record<string, any>,
	TName extends DeepKeys<TData>,
>(
	props: Omit<
		ComponentProps<typeof Checkbox>,
		"id" | "value" | "onInput" | "onBlur" | "form"
	> & {
		form: SolidFormOutput<TData, any>;
		fieldClass?: string;
		name: TName & (string & {});
		label?: string;
		labelClasses?: string;
		description?: string;
		descriptionClasses?: string;
		onChange?: (e: boolean) => void;
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
		"description",
		"descriptionClasses",
		"fieldClass",
	]);
	const id = createUniqueId();

	return (
		<props.form.Field name={props.name} {...props.fieldProps}>
			{(field) => (
				<div class={clsx("items-top flex space-x-2", props.fieldClass)}>
					<Checkbox
						{...inputProps}
						id={id}
						checked={field().state.value as any}
						onChange={(e) => {
							if ("onInput" in props) props.onChange?.(e);
							field().handleChange(e as any); // TODO: Constrain this component to only work where `typeof TData[TName] === "boolean"`
						}}
						onBlur={() => field().handleBlur()}
					/>
					<div class="grid gap-1.5 leading-none">
						{props.label && (
							<Label for={id} class={props.labelClasses}>
								{props.label}
							</Label>
						)}
						<p
							class={
								props.descriptionClasses ?? "text-sm text-muted-foreground"
							}
						>
							{props.description}
						</p>
					</div>
				</div>
			)}
		</props.form.Field>
	);
}
