import * as DialogPrimitive from "@kobalte/core/dialog";
import type { PolymorphicProps } from "@kobalte/core/polymorphic";
import type { Component } from "solid-js";
import { createEffect, onCleanup, Show } from "solid-js";
import { isServer } from "@solidjs/web";
import type { ComponentProps, JSX, ValidComponent } from "@solidjs/web";
import { mergeProps, splitProps } from "~/lib/solid";

import { cn } from "~/lib/utils";
import { Button } from "~/components/ui/button";
import { X } from "~/components/ui/icons";

const Dialog: Component<DialogPrimitive.DialogRootProps> = (props) => {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
};

type DialogTriggerProps<T extends ValidComponent = "button"> = PolymorphicProps<
  T,
  DialogPrimitive.DialogTriggerProps<T>
>;

const DialogTrigger = <T extends ValidComponent = "button">(props: DialogTriggerProps<T>) => {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
};

const DialogPortal = (props: DialogPrimitive.DialogPortalProps) => {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
};

type DialogCloseProps<T extends ValidComponent = "button"> = PolymorphicProps<
  T,
  DialogPrimitive.DialogCloseButtonProps<T>
>;

const DialogClose = <T extends ValidComponent = "button">(props: DialogCloseProps<T>) => {
  return <DialogPrimitive.CloseButton data-slot="dialog-close" {...props} />;
};

type DialogOverlayProps<T extends ValidComponent = "div"> = PolymorphicProps<
  T,
  DialogPrimitive.DialogOverlayProps<T>
> &
  Pick<ComponentProps<T>, "class">;

const DialogOverlay = <T extends ValidComponent = "div">(props: DialogOverlayProps<T>) => {
  // SAFETY: `splitProps` must see the concrete component props type to remove
  // the wrapper-owned keys; `T` only varies the polymorphic element and does not
  // change those keys.
  const [local, others] = splitProps(props as DialogOverlayProps, ["class"]);

  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      class={cn("fixed inset-0 isolate z-50 z-dialog-overlay", local.class)}
      {...others}
    />
  );
};

type DialogContentProps<T extends ValidComponent = "div"> = PolymorphicProps<
  T,
  DialogPrimitive.DialogContentProps<T>
> &
  Pick<ComponentProps<T>, "class" | "children"> & {
    showCloseButton?: boolean;
  };

const DialogContent = <T extends ValidComponent = "div">(props: DialogContentProps<T>) => {
  // SAFETY: the default props object is described by the component props type;
  // `merge` combines it with the caller's props under that same contract.
  const mergedProps = mergeProps({ showCloseButton: true } as DialogContentProps, props);
  const [local, others] = splitProps(mergedProps, ["class", "children", "showCloseButton"]);
  const context = DialogPrimitive.useDialogContext();
  let opener: HTMLElement | null = null;

  // Kobalte's dismissable layer fails to dispatch Escape for dialogs mounted
  // behind <Show> in this RC. A capture-phase listener is the one path that is
  // guaranteed to run before the event reaches an input inside the dialog.
  createEffect(
    () => undefined,
    () => {
      if (isServer) return;

      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key !== "Escape" || !context.isOpen()) return;

        event.preventDefault();
        event.stopPropagation();
        context.close();
      };

      window.addEventListener("keydown", onKeyDown, true);
      onCleanup(() => window.removeEventListener("keydown", onKeyDown, true));
    },
  );

  return (
    <DialogPrimitive.Portal>
      <DialogOverlay />
      <DialogPrimitive.Content
        aria-modal="true"
        data-slot="dialog-content"
        class={cn(
          "fixed top-1/2 left-1/2 z-50 z-dialog-content max-h-[calc(100dvh-2rem)] w-full -translate-x-1/2 -translate-y-1/2 overflow-y-auto text-foreground outline-none",
          local.class,
        )}
        onEscapeKeyDown={(event) => {
          event.preventDefault();
          context.close();
        }}
        onOpenAutoFocus={() => {
          opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();

          // The trigger can leave the DOM while the dialog is open (for
          // example after a route change), so only restore focus to a node
          // that is still connected. Otherwise fall back to the page's main
          // landmark, and finally to the body, so focus never lands nowhere.
          const fallback = document.getElementById("main");

          if (fallback && !fallback.hasAttribute("tabindex")) fallback.tabIndex = -1;
          const target = opener?.isConnected ? opener : (fallback ?? document.body);

          target.focus({ preventScroll: true });
        }}
        {...others}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;

          // Kobalte's DismissableLayer does not fire onEscapeKeyDown for
          // lazily-mounted dialogs in this RC, so close from the DOM event.
          event.preventDefault();
          event.stopPropagation();
          context.close();
        }}
      >
        <DialogBackgroundIsolation />
        {local.children}
        <Show when={local.showCloseButton}>
          <DialogPrimitive.CloseButton
            as={Button}
            variant="ghost"
            size="icon-sm"
            data-slot="dialog-close"
            class="z-dialog-close"
          >
            <X />
            <span class="sr-only">Close</span>
          </DialogPrimitive.CloseButton>
        </Show>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
};

type DialogHeaderProps = ComponentProps<"div">;

const DialogHeader = (props: DialogHeaderProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <div
      data-slot="dialog-header"
      class={cn("z-dialog-header flex flex-col", local.class)}
      {...others}
    />
  );
};

type DialogFooterProps<T extends ValidComponent = "div"> = PolymorphicProps<
  T,
  ComponentProps<"div">
> &
  Pick<ComponentProps<T>, "class" | "children"> & {
    showCloseButton?: boolean;
  };

const DialogFooter = <T extends ValidComponent = "div">(props: DialogFooterProps<T>) => {
  // SAFETY: the default props object is described by the component props type;
  // `merge` combines it with the caller's props under that same contract.
  const mergedProps = mergeProps({ showCloseButton: false } as DialogFooterProps, props);
  const [local, others] = splitProps(mergedProps, ["class", "children", "showCloseButton"]);

  return (
    <div
      data-slot="dialog-footer"
      class={cn(
        "z-dialog-footer flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        local.class,
      )}
      // SAFETY: `others` has already had the footer-only keys removed,
      // leaving the intrinsic div attributes this spread forwards.
      {...(others as JSX.HTMLAttributes<HTMLDivElement>)}
    >
      {local.children}
      <Show when={local.showCloseButton}>
        <DialogPrimitive.CloseButton as={Button} variant="outline">
          Close
        </DialogPrimitive.CloseButton>
      </Show>
    </div>
  );
};

type DialogTitleProps<T extends ValidComponent = "h2"> = PolymorphicProps<
  T,
  DialogPrimitive.DialogTitleProps<T>
> &
  Pick<ComponentProps<T>, "class">;

const DialogTitle = <T extends ValidComponent = "h2">(props: DialogTitleProps<T>) => {
  // SAFETY: `splitProps` must see the concrete component props type to remove
  // the wrapper-owned keys; `T` only varies the polymorphic element and does not
  // change those keys.
  const [local, others] = splitProps(props as DialogTitleProps, ["class"]);

  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      class={cn("z-dialog-title", local.class)}
      {...others}
    />
  );
};

type DialogDescriptionProps<T extends ValidComponent = "p"> = PolymorphicProps<
  T,
  DialogPrimitive.DialogDescriptionProps<T>
> &
  Pick<ComponentProps<T>, "class">;

const DialogDescription = <T extends ValidComponent = "p">(props: DialogDescriptionProps<T>) => {
  // SAFETY: `splitProps` must see the concrete component props type to remove
  // the wrapper-owned keys; `T` only varies the polymorphic element and does not
  // change those keys.
  const [local, others] = splitProps(props as DialogDescriptionProps, ["class"]);

  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      class={cn("z-dialog-description", local.class)}
      {...others}
    />
  );
};

/**
 * Kobalte's modal layer in this Solid 2 RC marks the body (not its siblings)
 * `aria-hidden`, which hides the dialog itself from assistive technology. Undo
 * that attribute; the focus scope still keeps keyboard focus inside the dialog.
 * Hiding the background properly needs a portal-aware primitive fix.
 */
export function DialogBackgroundIsolation() {
  createEffect(
    () => undefined,
    () => {
      if (isServer) return;

      const clear = () => {
        if (document.body.getAttribute("aria-hidden") === "true")
          document.body.removeAttribute("aria-hidden");
      };

      clear();

      const observer = new MutationObserver(clear);

      observer.observe(document.body, { attributes: true, attributeFilter: ["aria-hidden"] });
      onCleanup(() => observer.disconnect());
    },
  );

  return null;
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
