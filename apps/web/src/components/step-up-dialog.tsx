import { createMemo, createSignal, For, Show } from "solid-js";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@mattrax/ui";
import { errorMessage, raisedFailure } from "~/lib/errors";
import { isPasskeyCancellation, performStepUp } from "~/lib/step-up";
import {
  cancelStepUp,
  completeStepUp,
  pendingStepUp,
  rememberStepUpGrant,
  stepUpActionLabel,
} from "~/lib/step-up-bus";
import type { StepUpMethod } from "~/lib/step-up-bus";
import { Input } from "@mattrax/ui";
import { Button } from "@mattrax/ui";

/** Inline alerts arrive with a short rise so the state change is legible. */
const feedbackEnter = "motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-1 motion-safe:duration-150";

const labels: Record<StepUpMethod, string> = {
  totp: "Authenticator code",
  passkey: "Passkey",
};

/**
 * Global confirmation prompt for sensitive actions. Sensitive API calls reject
 * with `StepUpRequired`; the client retries them after this dialog issues a
 * short-lived grant bound to the session and the action.
 *
 * It uses the shared dialog primitive so it portals above any other open modal
 * (for example the API-token dialog) and participates in focus management.
 */
export default function StepUpDialog() {
  const [method, setMethod] = createSignal<StepUpMethod>("passkey");
  const [code, setCode] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  const [pending, setPending] = createSignal(false);

  const request = pendingStepUp;
  const available = createMemo(() => request()?.methods ?? []);

  // The account may not have the preferred factor (for example an SSO-only
  // account with TOTP). Fall back to the first method the server offered.
  const activeMethod = () =>
    available().includes(method()) ? method() : (available()[0] ?? method());

  const choose = (next: StepUpMethod) => {
    setMethod(next);
    setError(null);
  };

  const submit = async (event?: SubmitEvent) => {
    event?.preventDefault();
    const current = request();

    if (!current) return;
    const selectedMethod = activeMethod();

    setError(null);
    setPending(true);

    try {
      const grant = await performStepUp(current.action, selectedMethod, {
        code: code(),
      });

      rememberStepUpGrant(current.action, grant.grant, grant.expiresAtMillis);
      completeStepUp(grant.grant);
      setCode("");
    } catch (error_) {
      const message = errorMessage(
        raisedFailure(error_),
        "We couldn't confirm that action. Try again.",
      );

      if (selectedMethod === "passkey" && isPasskeyCancellation(error_)) {
        cancelStepUp(error_ instanceof Error ? error_ : new Error(message));

        return;
      }

      setError(message);
    } finally {
      setPending(false);
    }
  };

  const close = () => {
    setCode("");
    setError(null);
    cancelStepUp();
  };

  return (
    <Show when={request()}>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        <DialogContent showCloseButton={false} class="max-w-sm">
          <Show when={request()}>
            {(current) => (
              <div class="p-6">
                <DialogTitle>
                  Confirm it's you
                </DialogTitle>
                <DialogDescription class="mt-1">
                  For your security, confirm your identity to {stepUpActionLabel(current().action)}.
                </DialogDescription>

                <div
                  role="group"
                  aria-label="Confirmation method"
                  class="mt-4 inline-flex max-w-full flex-wrap gap-1 rounded-lg border border-border bg-muted/40 p-1 text-xs"
                >
                  <For each={available()}>
                    {(item) => (
                      <Button
                        type="button"
                        aria-pressed={activeMethod() === item ? "true" : "false"}
                        disabled={pending()}
                        variant={activeMethod() === item ? "secondary" : "ghost"}
                        onClick={() => choose(item)}
                      >
                        {labels[item]}
                      </Button>
                    )}
                  </For>
                </div>

                <p role="status" aria-live="polite" class="sr-only">
                  Confirming with {labels[activeMethod()].toLowerCase()}.
                </p>

                <form onSubmit={submit} class="mt-4 space-y-3">
                  <Show when={activeMethod() === "totp"}>
                    <div class="space-y-1.5">
                      <label for="step-up-code" class="text-xs font-medium text-foreground/90">
                        6-digit authenticator code
                      </label>
                      <Input
                        id="step-up-code"
                        required
                        autocomplete="one-time-code"
                        inputmode="numeric"
                        placeholder="000000"
                        aria-invalid={error() ? "true" : undefined}
                        aria-describedby={error() ? "step-up-error" : undefined}
                        value={code()}
                        onInput={(event) => setCode(event.currentTarget.value)}
                        class="h-9 w-full"
                      />
                    </div>
                  </Show>

                  <Show when={activeMethod() === "passkey"}>
                    <p class="text-sm text-muted-foreground">
                      Use the passkey saved on this device or a nearby device.
                    </p>
                  </Show>

                  <Show when={error()}>
                    {(message) => (
                      <p
                        id="step-up-error"
                        role="alert"
                        class={`text-sm text-destructive ${feedbackEnter}`}
                      >
                        {message()}
                      </p>
                    )}
                  </Show>

                  <div class="flex gap-2">
                    <Button
                      type="submit"
                      disabled={pending()}
                      aria-busy={pending() ? "true" : "false"}
                    >
                      {pending()
                        ? "Confirming…"
                        : activeMethod() === "passkey"
                          ? "Use passkey"
                          : "Confirm"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={pending()}
                      onClick={close}
                    >
                      Cancel
                    </Button>
                  </div>
                </form>
              </div>
            )}
          </Show>
        </DialogContent>
      </Dialog>
    </Show>
  );
}
