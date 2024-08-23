import {
	type ComponentProps,
	type JSX,
	createUniqueId,
	splitProps,
} from "solid-js";

import clsx from "clsx";
import { Input, Label } from "..";
import { Field, type FormState, type KeysMatching } from "./createForm";

export function InputField<T, K extends KeysMatching<T, string>>(
	props: Omit<
		ComponentProps<typeof Input>,
		"id" | "value" | "onInput" | "onBlur" | "form"
	> & {
		form: FormState<T>;
		fieldClass?: string;
		name: K;
		label?: JSX.Element;
		labelClasses?: string;
		onInput?: (
			e: InputEvent & {
				currentTarget: HTMLInputElement;
				target: HTMLInputElement;
			},
		) => void;
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
		<Field name={props.name} form={props.form}>
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
						value={field.value as any}
						onInput={(e) => {
							if ("onInput" in props) props.onInput?.(e);
							field.value = e.currentTarget.value as any;
						}}
						// This is a workaround to prevent the browser from asking to save the password
						readOnly={
							props.autocomplete === "off" && props.form.isSubmitting
								? true
								: props.readOnly
						}
					/>
				</div>
			)}
		</Field>
	);
}
