import type { ComponentProps } from "@solidjs/web";
import { splitProps } from "./lib/solid";
import { cn } from "./lib/cn";

const fieldBase =
  "w-full rounded-md border border-input bg-card px-2.5 text-xs text-foreground shadow-card outline-none transition duration-150 placeholder:text-subtle-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/15";

function Input(props: ComponentProps<"input">) {
  const [local, others] = splitProps(props, ["class", "type"]);

  return (
    <input
      type={local.type ?? "text"}
      data-slot="input"
      class={cn(fieldBase, "h-8", local.class)}
      {...others}
    />
  );
}

function Textarea(props: ComponentProps<"textarea">) {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <textarea
      data-slot="textarea"
      class={cn(fieldBase, "min-h-20 resize-y py-2 leading-5", local.class)}
      {...others}
    />
  );
}

function Label(props: ComponentProps<"label">) {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <label
      data-slot="label"
      class={cn(
        "flex select-none items-center gap-1 text-xs font-medium text-foreground peer-disabled:cursor-not-allowed peer-disabled:opacity-60",
        local.class,
      )}
      {...others}
    />
  );
}

function Field(props: ComponentProps<"div">) {
  const [local, others] = splitProps(props, ["class"]);

  return <div data-slot="field" class={cn("grid gap-1.5", local.class)} {...others} />;
}

function FieldHint(props: ComponentProps<"p">) {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <p
      data-slot="field-hint"
      class={cn("text-xs leading-4 text-muted-foreground", local.class)}
      {...others}
    />
  );
}

function FieldError(props: ComponentProps<"p">) {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <p
      data-slot="field-error"
      role="alert"
      class={cn("text-xs leading-4 text-destructive", local.class)}
      {...others}
    />
  );
}

export { Field, FieldError, FieldHint, Input, Label, Textarea };
