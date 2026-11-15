import { createMemo, createSignal, For, Show } from "solid-js";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "~/components/ui/dialog";
import { errorMessage, raisedFailure } from "~/lib/errors";
import { performStepUp } from "~/lib/step-up";
import {
  cancelStepUp,
  completeStepUp,
  pendingStepUp,
  rememberStepUpGrant,
  stepUpActionLabel,
  type StepUpMethod,
} from "~/lib/step-up-bus";

const inputClass =
  "h-9 w-full rounded-lg border border-input bg-background px-3 text-[13px] text-foreground placeholder:text-muted-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/25";

const primaryButton =
  "rounded-lg bg-primary px-3.5 py-2 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50";

const secondaryButton =
  "rounded-lg border border-white/[0.09] px-3.5 py-2 text-[13px] font-medium text-foreground transition-colors hover:bg-white/[0.05] disabled:opacity-50";

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
export function StepUpDialog() {
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
    setError(null);
    setPending(true);

    try {
      const grant = await performStepUp(current.action, activeMethod(), {
        code: code(),
      });

      rememberStepUpGrant(current.action, grant.grant, grant.expiresAtMillis);
      completeStepUp(grant.grant);
      setCode("");
    } catch (cause) {
      setError(errorMessage(raisedFailure(cause), "We couldn't confirm that action. Try again."));
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
    <Dialog
      open={request() !== null}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent showCloseButton={false} class="max-w-sm p-6">
        <Show when={request()}>
          {(current) => (
            <div>
              <DialogTitle class="text-base font-semibold text-foreground">
                Confirm it's you
              </DialogTitle>
              <DialogDescription class="mt-1 text-sm text-muted-foreground">
                For your security, confirm your identity to {stepUpActionLabel(current().action)}.
              </DialogDescription>

              <div
                role="group"
                aria-label="Confirmation method"
                class="mt-4 flex flex-wrap gap-2 text-xs"
              >
                <For each={available()}>
                  {(item) => (
                    <button
                      type="button"
                      aria-pressed={activeMethod() === item ? "true" : "false"}
                      class={`rounded-md px-2.5 py-1.5 font-medium transition-colors ${
                        activeMethod() === item
                          ? "bg-brand text-brand-foreground"
                          : "border border-stone-300 text-foreground/90 hover:bg-stone-100"
                      }`}
                      onClick={() => choose(item)}
                    >
                      {labels[item]}
                    </button>
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
                    <input
                      id="step-up-code"
                      required
                      autocomplete="one-time-code"
                      inputmode="numeric"
                      placeholder="000000"
                      aria-invalid={error() ? "true" : undefined}
                      aria-describedby={error() ? "step-up-error" : undefined}
                      value={code()}
                      onInput={(event) => setCode(event.currentTarget.value)}
                      class={inputClass}
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
                    <p id="step-up-error" role="alert" class="text-sm text-destructive">
                      {message()}
                    </p>
                  )}
                </Show>

                <div class="flex gap-2">
                  <button type="submit" class={primaryButton} disabled={pending()}>
                    {pending() ? "Confirming…" : activeMethod() === "passkey" ? "Use passkey" : "Confirm"}
                  </button>
                  <button
                    type="button"
                    class={secondaryButton}
                    disabled={pending()}
                    onClick={close}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          )}
        </Show>
      </DialogContent>
    </Dialog>
  );
}
