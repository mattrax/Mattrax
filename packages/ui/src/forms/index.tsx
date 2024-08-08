import type { Validator, createForm } from "@tanstack/solid-form";

export * from "./Form";
export * from "./InputField";
export * from "./SelectField";

export type SolidFormOutput<
	TData,
	T extends Validator<TData, unknown> | undefined = undefined,
> = ReturnType<typeof createForm<TData, T>>;
