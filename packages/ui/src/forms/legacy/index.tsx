// TODO: Remove this folder once all UI is migrated to the new form solution.

import type { FormApi, SolidFormApi, Validator } from "@tanstack/solid-form";

export * from "./Form";
export * from "./InputField";
export * from "./SelectField";
export * from "./CheckboxField";

export type SolidFormOutput<
	TData,
	T extends Validator<TData, unknown> | undefined = undefined,
> = FormApi<TData, T> & SolidFormApi<TData, T>;
