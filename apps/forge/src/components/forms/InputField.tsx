import {
  Component,
  ComponentProps,
  createUniqueId,
  splitProps,
  JSX,
  Accessor,
} from "solid-js";
import { DeepKeys, FieldApi, FormApi } from "@tanstack/solid-form";

import { Input, Label } from "../ui";
import { clsx } from "clsx";

export function InputField<
  TData extends Record<string, any>,
  TName extends DeepKeys<TData>
>(
  props: Omit<
    ComponentProps<typeof Input>,
    "id" | "value" | "onInput" | "onBlur" | "form"
  > & {
    form: FormApi<TData, any>;
    fieldClass?: string;
    name: TName;
    label?: string;
  }
) {
  const [_, inputProps] = splitProps(props, [
    "form",
    "name",
    "label",
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
          {props.label !== undefined && <Label for={id}>{props.label}</Label>}
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
