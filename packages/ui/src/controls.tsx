import type { ComponentProps, JSX } from "@solidjs/web";
import { splitProps } from "./lib/solid";
import { Checkbox as CheckboxPrimitive, CheckboxIndicator } from "@ui-sdk/solid/checkbox";
import { Switch as SwitchPrimitive, SwitchThumb } from "@ui-sdk/solid/switch";
import { cn } from "./lib/cn";
import { Check } from "./icons";

type CheckboxProps = ComponentProps<typeof CheckboxPrimitive> & {
  class?: string;
  children?: JSX.Element;
};

function Checkbox(props: CheckboxProps) {
  const [local, others] = splitProps(props, ["class", "children"]);

  return (
    <CheckboxPrimitive
      class={cn(
        "flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-input bg-card text-primary-foreground outline-none transition-[background-color,border-color,box-shadow]",
        "hover:border-border-strong focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/25",
        "data-checked:border-primary data-checked:bg-primary data-indeterminate:border-primary data-indeterminate:bg-primary",
        "data-disabled:cursor-not-allowed data-disabled:opacity-45",
        local.class,
      )}
      {...others}
    >
      <CheckboxIndicator class="flex items-center justify-center data-unchecked:hidden">
        <Check class="size-3 animate-[mt-check-in_160ms_var(--ease-swift)]" stroke-width={3} />
      </CheckboxIndicator>
      {local.children}
    </CheckboxPrimitive>
  );
}

type SwitchProps = ComponentProps<typeof SwitchPrimitive> & { class?: string };

function Switch(props: SwitchProps) {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <SwitchPrimitive
      class={cn(
        "relative inline-flex h-[18px] w-8 shrink-0 cursor-pointer items-center rounded-full border border-transparent bg-border-strong p-0 outline-none transition-colors duration-150 ease-swift",
        "focus-visible:ring-[3px] focus-visible:ring-ring/30 data-checked:bg-primary data-disabled:cursor-not-allowed data-disabled:opacity-45",
        local.class,
      )}
      {...others}
    >
      <SwitchThumb
        class={cn(
          "pointer-events-none block size-3.5 rounded-full bg-card shadow-[0_1px_2px_rgb(24_24_22/0.25)] transition-transform duration-200 ease-swift",
          "translate-x-[2px] data-checked:translate-x-[15px]",
        )}
      />
    </SwitchPrimitive>
  );
}

/** A checkbox with its label and optional description, laid out as one row. */
function CheckboxField(props: {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  label: JSX.Element;
  description?: JSX.Element;
  class?: string;
}) {
  return (
    <label
      class={cn(
        "flex cursor-pointer items-start gap-2.5 rounded-md py-1.5 text-[12.5px] leading-5",
        props.disabled && "cursor-not-allowed opacity-60",
        props.class,
      )}
    >
      <Checkbox
        checked={props.checked ?? false}
        onCheckedChange={(checked) => props.onCheckedChange?.(checked === true)}
        disabled={props.disabled}
        class="mt-0.5"
      />
      <span class="grid gap-0.5">
        <span class="font-[500] text-foreground">{props.label}</span>
        {props.description ? (
          <span class="text-[11.5px] text-muted-foreground">{props.description}</span>
        ) : null}
      </span>
    </label>
  );
}

export { Checkbox, CheckboxField, Switch };
