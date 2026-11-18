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

/** A side panel that keeps the page in view, built on the same dialog behaviour. */
function Sheet(props: ComponentProps<typeof DialogPrimitive> & { children?: JSX.Element }) {
  return <DialogPrimitive {...props} />;
}

function SheetTrigger(props: ComponentProps<typeof DialogTrigger>) {
  return <DialogTrigger {...props} />;
}

function SheetContent(
  props: ComponentProps<typeof DialogContentPrimitive> & {
    class?: string;
    children?: JSX.Element;
    showCloseButton?: boolean;
    side?: "right" | "left";
  },
) {
  const [local, others] = splitProps(props, ["class", "children", "showCloseButton", "side"]);

  return (
    <>
      <DialogBackdrop
        class={cn(
          "fixed inset-0 z-[70] bg-scrim backdrop-blur-[1px] transition-opacity duration-[var(--duration-popover)] ease-swift",
          "data-[starting-style]:opacity-0 data-[ending-style]:opacity-0",
        )}
      />
      <DialogContentPrimitive
        class={cn(
          "fixed inset-y-0 right-0 z-[71] flex w-full max-w-md flex-col gap-5 overflow-y-auto border-l border-border bg-background p-5 shadow-panel outline-none",
          "transition-transform duration-[var(--duration-panel)] ease-glide data-[starting-style]:translate-x-full data-[ending-style]:translate-x-full",
          local.class,
        )}
        {...others}
      >
        {local.children}
        {local.showCloseButton === false ? null : (
          <DialogClose
            aria-label="Close"
            class="absolute right-4 top-4 flex size-7 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-hover hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/30"
          >
            <X class="size-4" />
          </DialogClose>
        )}
      </DialogContentPrimitive>
    </>
  );
}

function SheetHeader(props: Omit<ComponentProps<"div">, "style">) {
  const [local, others] = splitProps(props, ["class"]);

  return <div class={cn("grid gap-1 pr-8", local.class)} {...others} />;
}

function SheetFooter(props: Omit<ComponentProps<"div">, "style">) {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <div
      class={cn("mt-auto flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4", local.class)}
      {...others}
    />
  );
}

function SheetTitle(props: ComponentProps<typeof DialogTitle>) {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <DialogTitle
      class={cn("text-[15px] font-[600] leading-6 tracking-[-0.02em]", local.class)}
      {...others}
    />
  );
}

function SheetDescription(props: ComponentProps<typeof DialogDescription>) {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <DialogDescription
      class={cn("text-[12.5px] leading-5 text-muted-foreground", local.class)}
      {...others}
    />
  );
}

export {
  Sheet,
  SheetCloseButton as SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
};

function SheetCloseButton(props: ComponentProps<typeof DialogClose>) {
  return <DialogClose {...props} />;
}
