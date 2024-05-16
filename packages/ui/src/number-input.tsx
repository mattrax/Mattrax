import { splitProps, type Component } from "solid-js";

import { NumberField as NumberInputPrimitive } from "@kobalte/core";
import { cn } from "./lib";

const NumberInput = NumberInputPrimitive.Root;

const NumberInputLabel: Component<NumberInputPrimitive.NumberFieldLabelProps> =
	(props) => {
		const [, rest] = splitProps(props, ["class"]);
		return (
			<NumberInputPrimitive.Label
				class={cn(
					"text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
					props.class,
				)}
				{...rest}
			/>
		);
	};

const NumberInputControl: Component<
	NumberInputPrimitive.NumberFieldInputProps
> = (props) => {
	const [, rest] = splitProps(props, ["class"]);
	return (
		<NumberInputPrimitive.Input
			class={cn(
				"flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 data-[invalid]:border-error-foreground data-[invalid]:text-error-foreground",
				props.class,
			)}
			{...rest}
		/>
	);
};

const NumberInputIncrementTrigger: Component<
	NumberInputPrimitive.NumberFieldIncrementTriggerProps
> = (props) => {
	const [, rest] = splitProps(props, ["class", "children"]);
	return (
		<NumberInputPrimitive.IncrementTrigger
			class={cn(
				"absolute right-1 top-1 inline-flex size-4 items-center justify-center",
				props.class,
			)}
			{...rest}
		>
			{props.children ?? (
				<svg
					xmlns="http://www.w3.org/2000/svg"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					class="size-4"
				>
					<path d="M6 15l6 -6l6 6" />
				</svg>
			)}
		</NumberInputPrimitive.IncrementTrigger>
	);
};

const NumberInputDecrementTrigger: Component<
	NumberInputPrimitive.NumberFieldDecrementTriggerProps
> = (props) => {
	const [, rest] = splitProps(props, ["class", "children"]);
	return (
		<NumberInputPrimitive.DecrementTrigger
			class={cn(
				"absolute bottom-1 right-1 inline-flex size-4 items-center justify-center",
				props.class,
			)}
			{...rest}
		>
			{props.children ?? (
				<svg
					xmlns="http://www.w3.org/2000/svg"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					class="size-4"
				>
					<path d="M6 9l6 6l6 -6" />
				</svg>
			)}
		</NumberInputPrimitive.DecrementTrigger>
	);
};

const NumberInputDescription: Component<
	NumberInputPrimitive.NumberFieldDescriptionProps
> = (props) => {
	const [, rest] = splitProps(props, ["class"]);
	return (
		<NumberInputPrimitive.Description
			class={cn("text-sm text-muted-foreground", props.class)}
			{...rest}
		/>
	);
};

const NumberInputErrorMessage: Component<
	NumberInputPrimitive.NumberFieldErrorMessageProps
> = (props) => {
	const [, rest] = splitProps(props, ["class"]);
	return (
		<NumberInputPrimitive.ErrorMessage
			class={cn("text-sm text-error-foreground", props.class)}
			{...rest}
		/>
	);
};

export {
	NumberInput,
	NumberInputLabel,
	NumberInputControl,
	NumberInputIncrementTrigger,
	NumberInputDecrementTrigger,
	NumberInputDescription,
	NumberInputErrorMessage,
};
