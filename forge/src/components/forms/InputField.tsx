import { ComponentProps, createUniqueId, splitProps } from "solid-js";
import { DeepKeys, FormApi } from "@tanstack/solid-form";

import { Input, Label } from "../ui";

export function InputField<TData extends Record<string, any>, TName>(
  props: Omit<
    ComponentProps<typeof Input>,
    "id" | "value" | "onInput" | "onBlur" | "form"
  > & {
    form: FormApi<TData, any>;
    name: DeepKeys<TData>;
    label?: string;
  }
) {
  const [_, inputProps] = splitProps(props, ["form", "name", "label"]);
  const id = createUniqueId();

  return (
    <props.form.Field name={props.name}>
      {(field) => (
        <div class="flex flex-col space-y-1.5">
          {props.label !== undefined && <Label for={id}>{props.label}</Label>}
          <Input
            {...inputProps}
            id={id}
            value={field().state.value}
            onInput={(e) => field().handleChange(e.currentTarget.value)}
            onBlur={() => field().handleBlur()}
          />
        </div>
      )}
    </props.form.Field>
  );
}
