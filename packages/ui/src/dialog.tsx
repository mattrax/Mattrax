import type { ComponentProps, JSX } from "@solidjs/web";
import { splitProps } from "./lib/solid";
import {
  Dialog as DialogPrimitive,
  DialogBackdrop,
  DialogClose,
  DialogContent as DialogContentPrimitive,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@ui-sdk/solid/dialog";
import { cn } from "./lib/cn";
import { X } from "./icons";

type DialogProps = ComponentProps<typeof DialogPrimitive> & {
  children?: JSX.Element;
};

/** A focused task over the page. Controlled with `open` / `onOpenChange`. */
function Dialog(props: DialogProps) {
  return <DialogPrimitive {...props} />;
}

type DialogContentProps = ComponentProps<typeof DialogContentPrimitive> & {
  class?: string;
  children?: JSX.Element;
  showCloseButton?: boolean;
};

function DialogContent(props: DialogContentProps) {
  const [local, others] = splitProps(props, ["class", "children", "showCloseButton"]);

  return (
    <>
      <DialogBackdrop
        data-slot="dialog-backdrop"
        class={cn(
          "fixed inset-0 z-[70] bg-scrim backdrop-blur-[2px] transition-opacity duration-[var(--duration-popover)] ease-swift",
          "data-[starting-style]:opacity-0 data-[ending-style]:opacity-0",
        )}
      />
      <DialogContentPrimitive
        data-slot="dialog-content"
        class={cn(
          "fixed left-1/2 top-1/2 z-[71] flex max-h-[min(85vh,44rem)] w-[min(calc(100vw-2rem),32rem)] -translate-x-1/2 -translate-y-1/2 flex-col gap-4",
          "overflow-y-auto rounded-xl border border-border bg-popover p-5 text-popover-foreground shadow-panel outline-none",
          "transition-[opacity,transform] duration-[var(--duration-panel)] ease-swift",
          "data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0 data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0",
          local.class,
        )}
        {...others}
      >
        {local.children}
        {local.showCloseButton === false ? null : (
          <DialogClose
            aria-label="Close"
            class="absolute right-3 top-3 flex size-7 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-hover hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/30"
          >
            <X class="size-4" />
          </DialogClose>
        )}
      </DialogContentPrimitive>
    </>
  );
}

function DialogHeader(props: ComponentProps<"div">) {
  const [local, others] = splitProps(props, ["class"]);

  return <div class={cn("grid gap-1 pr-6", local.class)} {...others} />;
}

function DialogFooter(props: ComponentProps<"div">) {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <div
      class={cn("-mx-5 -mb-5 mt-1 flex flex-wrap items-center justify-end gap-2 rounded-b-xl border-t border-border bg-surface px-5 py-3", local.class)}
      {...others}
    />
  );
}

function DialogTitleText(props: ComponentProps<typeof DialogTitle>) {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <DialogTitle
      class={cn("text-[15px] font-[600] leading-6 tracking-[-0.02em]", local.class)}
      {...others}
    />
  );
}

function DialogDescriptionText(props: ComponentProps<typeof DialogDescription>) {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <DialogDescription
      class={cn("text-[12.5px] leading-5 text-muted-foreground", local.class)}
      {...others}
    />
  );
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescriptionText as DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitleText as DialogTitle,
  DialogTrigger,
};
