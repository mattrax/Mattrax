import type { Component, ComponentProps, JSX, ParentProps } from "solid-js";
import { splitProps } from "solid-js";
import { Dialog as DialogPrimitive } from "@kobalte/core";
import { TbX } from "solid-icons/tb";

import { Controller, ControllerProvider, createController } from "./controller";
import { cn } from "~/lib/utils";

// An easy wrapper on the dialog primitives
const Dialog: Component<
  ParentProps<{
    controller?: Controller;
    trigger?: JSX.Element;
  }>
> = (props) => (
  <DialogRoot controller={props.controller}>
    {props.trigger && <DialogTrigger>{props.trigger}</DialogTrigger>}
    <DialogContent>
      <DialogHeader>{props.children}</DialogHeader>
    </DialogContent>
  </DialogRoot>
);

const DialogRoot: Component<
  Omit<DialogPrimitive.DialogRootProps, "open"> &
    (
      | {
          open: boolean;
          setOpen: (open: boolean) => void;
        }
      | {
          controller?: Controller;
        }
    )
> = (props) => {
  const controller =
    "controller" in props && props.controller !== undefined
      ? props.controller
      : createController();

  return (
    <ControllerProvider value={controller}>
      <DialogPrimitive.Root
        open={("open" in props ? props.open : false) || controller.open()}
        onOpenChange={(isOpen) => {
          if ("setOpen" in props) props.setOpen(isOpen);
          controller.setOpen(isOpen);
        }}
        {...props}
      />
    </ControllerProvider>
  );
};

const DialogTrigger: Component<DialogPrimitive.DialogTriggerProps> = (
  props
) => {
  const [, rest] = splitProps(props, ["children"]);
  return (
    <DialogPrimitive.Trigger {...rest}>
      {props.children}
    </DialogPrimitive.Trigger>
  );
};

const DialogPortal: Component<DialogPrimitive.DialogPortalProps> = (props) => {
  const [, rest] = splitProps(props, ["children"]);
  return (
    <DialogPrimitive.Portal {...rest}>
      <div class="fixed inset-0 z-50 flex items-start justify-center sm:items-center">
        {props.children}
      </div>
    </DialogPrimitive.Portal>
  );
};

const DialogOverlay: Component<DialogPrimitive.DialogOverlayProps> = (
  props
) => {
  const [, rest] = splitProps(props, ["class"]);
  return (
    <DialogPrimitive.Overlay
      class={cn(
        "bg-background/80 data-[expanded]:animate-in data-[closed]:animate-out data-[closed]:fade-out-0 data-[expanded]:fade-in-0 fixed inset-0 z-50 backdrop-blur-sm",
        props.class
      )}
      {...rest}
    />
  );
};

const DialogContent: Component<DialogPrimitive.DialogContentProps> = (
  props
) => {
  const [, rest] = splitProps(props, ["class", "children"]);
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        class={cn(
          "bg-background data-[expanded]:animate-in data-[closed]:animate-out data-[closed]:fade-out-0 data-[expanded]:fade-in-0 data-[closed]:zoom-out-95 data-[expanded]:zoom-in-95 data-[closed]:slide-out-to-left-1/2 data-[closed]:slide-out-to-top-[48%] data-[expanded]:slide-in-from-left-1/2 data-[expanded]:slide-in-from-top-[48%] fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border p-6 shadow-lg duration-200 sm:rounded-lg",
          props.class
        )}
        {...rest}
      >
        {props.children}
        <DialogPrimitive.CloseButton class="ring-offset-background focus:ring-ring data-[expanded]:bg-accent data-[expanded]:text-muted-foreground absolute right-4 top-4 rounded-sm opacity-70 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:pointer-events-none">
          <TbX class="h-4 w-4" />
          <span class="sr-only">Close</span>
        </DialogPrimitive.CloseButton>
      </DialogPrimitive.Content>
    </DialogPortal>
  );
};

const DialogHeader: Component<ComponentProps<"div">> = (props) => {
  const [, rest] = splitProps(props, ["class"]);
  return (
    <div
      class={cn(
        "flex flex-col space-y-1.5 text-center sm:text-left",
        props.class
      )}
      {...rest}
    />
  );
};

const DialogFooter: Component<ComponentProps<"div">> = (props) => {
  const [, rest] = splitProps(props, ["class"]);
  return (
    <div
      class={cn(
        "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
        props.class
      )}
      {...rest}
    />
  );
};

const DialogTitle: Component<DialogPrimitive.DialogTitleProps> = (props) => {
  const [, rest] = splitProps(props, ["class"]);
  return (
    <DialogPrimitive.Title
      class={cn(
        "text-lg font-semibold leading-none tracking-tight",
        props.class
      )}
      {...rest}
    />
  );
};

const DialogDescription: Component<DialogPrimitive.DialogDescriptionProps> = (
  props
) => {
  const [, rest] = splitProps(props, ["class"]);
  return (
    <DialogPrimitive.Description
      class={cn("text-muted-foreground text-sm", props.class)}
      {...rest}
    />
  );
};

export {
  Dialog,
  DialogRoot,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
