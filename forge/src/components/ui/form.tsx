// TODO: Do this properly copying Brendan's blog post
// TODO: Input validation built into the components

import { ParentProps } from "solid-js";
import { createForm } from "@tanstack/solid-form";
import { zodValidator } from "@tanstack/zod-form-adapter";
import { z } from "zod";

// TODO: Take in Zod schema

export function Form(props: ParentProps<{ validator: z.AnyZodObject }>) {
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
      onChange: props.validator,
    },
  }));

  const disabled = () => false; // TODO: Finish this

  // useBeforeLeave((e) => {
  //   if (form.isDirty && !e.defaultPrevented) {
  //     // preventDefault to block immediately and prompt user async
  //     e.preventDefault();
  //     setTimeout(() => {
  //       if (window.confirm("Discard unsaved changes - are you sure?")) {
  //         // user wants to proceed anyway so retry with force=true
  //         e.retry(true);
  //       }
  //     }, 100);
  //   }
  // });

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
