import { useBeforeLeave } from "@solidjs/router";
import { createSignal, onSettled } from "solid-js";
import type { JSX } from "@solidjs/web";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";

type PendingChange = { readonly run: () => void };

export type UnsavedChangesGuard = {
  /**
   * Ask before running an action that would discard the edits, for example
   * closing an inline editor or a sheet.
   */
  confirm: (run: () => void) => void;
  /** Mount once in the page's JSX. */
  prompt: JSX.Element;
};

/**
 * Guard edits that have not been saved.
 *
 * Both escape hatches are covered: closing or reloading the tab (`beforeunload`)
 * and in-app navigation (`useBeforeLeave`). The prompt offers the two actions a
 * bare `confirm()` cannot express clearly — keep editing, or discard and go.
 *
 * The caller owns the dirty check, so a form that has just saved (or a drawer
 * that is already closed) never blocks a navigation it did not cause.
 */
export function useUnsavedChanges(
  dirty: () => boolean,
  options: {
    title?: string;
    description?: string;
    /** Navigation targets that may proceed without a prompt, e.g. sibling settings tabs. */
    allowNavigation?: (to: string) => boolean;
  } = {},
): UnsavedChangesGuard {
  const [pending, setPending] = createSignal<PendingChange | null>(null);

  const confirm = (run: () => void) => {
    if (!dirty()) {
      run();

      return;
    }

    setPending({ run });
  };

  useBeforeLeave((event) => {
    if (!dirty()) return;
    if (typeof event.to === "string" && options.allowNavigation?.(event.to)) return;
    event.preventDefault();
    setPending({ run: () => event.retry(true) });
  });

  onSettled(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty()) return;
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", beforeUnload);

    return () => window.removeEventListener("beforeunload", beforeUnload);
  });

  const discard = () => {
    const action = pending();

    setPending(null);
    action?.run();
  };

  const prompt = (
    <Dialog
      open={pending() !== null}
      onOpenChange={(open) => {
        if (!open) setPending(null);
      }}
    >
      <DialogContent class="max-w-md">
        <DialogHeader>
          <DialogTitle>{options.title ?? "Discard unsaved changes?"}</DialogTitle>
          <DialogDescription>
            {options.description ??
              "You have edits that have not been saved. Leaving now discards them."}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setPending(null)}>
            Keep editing
          </Button>
          <Button variant="destructive" onClick={discard}>
            Discard
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return { confirm, prompt };
}
