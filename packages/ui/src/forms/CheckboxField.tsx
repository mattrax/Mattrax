import {
	type ComponentProps,
	type JSX,
	createUniqueId,
	splitProps,
} from "solid-js";

import clsx from "clsx";
import { Checkbox, Label } from "..";
import { Field, type FormState, type KeysMatching } from "./createForm";

export function CheckboxField<T, K extends KeysMatching<T, boolean>>(
	props: Omit<
		ComponentProps<typeof Checkbox>,
		"id" | "value" | "onInput" | "onBlur" | "form"
	> & {
		form: FormState<T>;
		fieldClass?: string;
		name: K;
		label?: string;
		labelClasses?: string;
		description?: JSX.Element;
		descriptionClasses?: string;
		onChange?: (e: boolean) => void;
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
		<Field name={props.name} form={props.form}>
			{(field) => (
				<div class={clsx("items-top flex space-x-2", props.fieldClass)}>
					<Checkbox
						{...inputProps}
						id={id}
						checked={field.value as any}
						onChange={(e) => {
							if ("onInput" in props) props.onChange?.(e);
							field.value = e as any;
						}}
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
		</Field>
	);
}
