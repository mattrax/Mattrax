import { JSX, ParentProps, createContext, createSignal } from "solid-js";
import { Dialog as KDialog } from "@kobalte/core";

// TODO: Transition on dialog open/close
// TODO: Escape key not working to close dialog

const dialogContext = createContext();

export function createDialogController() {
  const [open, setOpen] = createSignal(false);
  return {
    open,
    setOpen,
  };
}

export function Dialog(
  props: ParentProps<
    | {
        controller: ReturnType<typeof createDialogController>;
      }
    | {
        trigger: JSX.Element;
      }
    | {}
  >
) {
  const controller =
    "controller" in props ? props.controller : createDialogController();

  return (
    <KDialog.Root open={controller.open()}>
      {"trigger" in props && (
        <KDialog.Trigger as="div">{props.trigger}</KDialog.Trigger>
      )}

      <KDialog.Portal>
        <KDialog.Overlay class="absolute inset-0 bg-black/40" />

        <KDialog.Content class="absolute inset-0 flex flex-col items-center py-10 overflow-hidden">
          <div class="bg-red-500">{props.children}</div>
        </KDialog.Content>
      </KDialog.Portal>
    </KDialog.Root>
  );
}

// <div class="dialog__header">
//   <KDialog.Title class="dialog__title">About Kobalte</KDialog.Title>
//   <KDialog.CloseButton class="dialog__close-button">
//     {/* <CrossIcon /> */}
//   </KDialog.CloseButton>
// </div>
// <KDialog.Description class="dialog__description">
//   Kobalte is a UI toolkit for building accessible web apps and design
//   systems with SolidJS. It provides a set of low-level UI components
//   and primitives which can be the foundation for your design system
//   implementation.
// </KDialog.Description>
