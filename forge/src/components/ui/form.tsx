// TODO: Do this properly copying Brendan's blog post
// TODO: Input validation built into the components

import { ParentProps } from "solid-js";
import { createForm } from "@tanstack/solid-form";
import { zodValidator } from "@tanstack/zod-form-adapter";
import { z } from "zod";

// TODO: Take in Zod schema

export function Form(props: ParentProps) {
  const form = createForm(() => ({
    defaultValues: {
      fullName: "",
    },
    onSubmit: async ({ value }) => {
      // Do something with form data
      console.log(value);
    },
    validatorAdapter: zodValidator,
    validators: {
      onChange: z.object({
        fullName: z.string(),
      }), // TODO: From props
    },
  }));

  const disabled = () => false; // TODO: Finish this

  return (
    <form.Provider>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          void form.handleSubmit();
        }}
      >
        <fieldset disabled={disabled()}>{props.children}</fieldset>

        {/* <div>
          <form.Field
            name="fullName"
            children={(field) => (
              <input
                name={field().name}
                value={field().state.value}
                onBlur={field().handleBlur}
                onInput={(e) => field().handleChange(e.target.value)}
              />
            )}
          />
        </div>
        <button type="submit">Submit</button> */}
      </form>
    </form.Provider>
  );
}
