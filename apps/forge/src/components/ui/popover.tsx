import type { Component } from "solid-js";
import { splitProps } from "solid-js";

import { Popover as PopoverPrimitive } from "@kobalte/core";

import { cn } from "~/lib/utils";
import { Controller, ControllerProvider, createController } from "./controller";

const Popover: Component<
  Omit<PopoverPrimitive.PopoverRootProps, "open"> &
    (
      | { open: boolean; setOpen: (open: boolean) => void }
      | { controller?: Controller }
    )
> = (props) => {
  const controller =
    "controller" in props && props.controller !== undefined
      ? props.controller
      : createController();

  return (
    <ControllerProvider value={controller}>
      <PopoverPrimitive.Root
        open={("open" in props ? props.open : false) || controller.open()}
        onOpenChange={(isOpen) => {
          if ("setOpen" in props) props.setOpen(isOpen);
          controller.setOpen(isOpen);
        }}
        gutter={4}
        {...props}
      />
    </ControllerProvider>
  );
};

const PopoverTrigger = PopoverPrimitive.Trigger;

const PopoverContent: Component<PopoverPrimitive.PopoverContentProps> = (
  props
) => {
  const [, rest] = splitProps(props, ["class"]);
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        class={cn(
          "bg-popover text-popover-foreground data-[expanded]:animate-in data-[closed]:animate-out data-[closed]:fade-out-0 data-[expanded]:fade-in-0 data-[closed]:zoom-out-95 data-[expanded]:zoom-in-95 z-50 w-72 origin-[var(--kb-popover-content-transform-origin)] rounded-md border shadow-md outline-none",
          props.class
        )}
        {...rest}
      />
    </PopoverPrimitive.Portal>
  );
};

const PopoverContentTight: Component<PopoverPrimitive.PopoverContentProps> = (
  props
) => {
  const [, rest] = splitProps(props, ["class"]);
  return <PopoverContent class={cn(props.class, "p-4")} {...props} />;
};

export { Popover, PopoverTrigger, PopoverContent };
