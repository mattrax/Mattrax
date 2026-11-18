import type { ComponentProps, JSX } from "@solidjs/web";
import { splitProps } from "./lib/solid";
import {
  Select as SelectPrimitive,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectItemIndicator,
  SelectLabel,
  SelectValue,
} from "@ui-sdk/solid/select";
import { SelectTrigger } from "@ui-sdk/solid/select";
import { cn } from "./lib/cn";
import { Check, ChevronDown } from "./icons";

type SelectProps = ComponentProps<typeof SelectPrimitive> & { children?: JSX.Element };

function Select(props: SelectProps) {
  return <SelectPrimitive {...props} />;
}

function SelectTriggerBox(props: ComponentProps<typeof SelectTrigger> & { class?: string }) {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <SelectTrigger
      class={cn(
        "flex h-8 w-full items-center justify-between gap-2 rounded-md border border-input bg-card px-2.5 text-[13px] text-foreground outline-none transition-[border-color,box-shadow]",
        "hover:border-border-strong focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50",
        local.class,
      )}
      {...others}
    />
  );
}

function SelectValueBox(props: ComponentProps<typeof SelectValue> & { class?: string }) {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <SelectValue
      class={cn("min-w-0 flex-1 truncate text-left data-placeholder:text-subtle-foreground", local.class)}
      {...others}
    />
  );
}

function SelectContentBox(props: ComponentProps<typeof SelectContent> & { class?: string }) {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <SelectContent
      sideOffset={6}
      class={cn(
        "z-[75] max-h-72 min-w-[var(--ui-anchor-width,10rem)] overflow-y-auto rounded-[10px] border border-border bg-popover p-1 text-popover-foreground shadow-popover outline-none",
        "data-[side=bottom]:origin-top data-[side=top]:origin-bottom data-[side=left]:origin-right data-[side=right]:origin-left transition-[opacity,transform] duration-[var(--duration-popover)] ease-swift data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0 data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0",
        local.class,
      )}
      {...others}
    />
  );
}

function SelectItemBox(props: ComponentProps<typeof SelectItem> & { class?: string }) {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <SelectItem
      class={cn(
        "relative flex h-8 cursor-default select-none items-center gap-2 rounded-[6px] px-2 pl-7 text-[12.5px] outline-none transition-colors duration-[var(--duration-press)]",
        "data-highlighted:bg-hover data-disabled:pointer-events-none data-disabled:opacity-45",
        local.class,
      )}
      {...others}
    >
      <span class="absolute left-2 flex size-3.5 items-center justify-center">
        <SelectItemIndicator>
          <Check class="size-3.5" />
        </SelectItemIndicator>
      </span>
      {props.children}
    </SelectItem>
  );
}

function SelectLabelBox(props: ComponentProps<typeof SelectLabel> & { class?: string }) {
  const [local, others] = splitProps(props, ["class"]);

  return <SelectLabel class={cn("label-caps flex h-7 items-center px-2", local.class)} {...others} />;
}

function SelectChevron() {
  return <ChevronDown class="size-3.5 shrink-0 text-muted-foreground" />;
}

/**
 * A styled native select for the many compact filters in the dashboard. It
 * keeps native keyboard and mobile behaviour while matching the design system.
 */
function NativeSelect(props: ComponentProps<"select">) {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <div class="relative">
      <select
        data-slot="native-select"
        class={cn(
          "h-8 w-full appearance-none rounded-md border border-input bg-card pl-2.5 pr-7 text-[12.5px] text-foreground outline-none transition-[border-color,box-shadow]",
          "hover:border-border-strong focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50",
          local.class,
        )}
        {...others}
      />
      <ChevronDown class="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
}

export {
  NativeSelect,
  Select,
  SelectChevron,
  SelectContentBox as SelectContent,
  SelectGroup,
  SelectItemBox as SelectItem,
  SelectLabelBox as SelectLabel,
  SelectTriggerBox as SelectTrigger,
  SelectValueBox as SelectValue,
};
