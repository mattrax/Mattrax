import { createMemo, createSignal, For, Show } from "solid-js";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "~/components/ui/dialog";
import { errorMessage } from "~/lib/errors";
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
  "w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 outline-none focus:border-stone-500 focus:ring-2 focus:ring-stone-200 transition-colors";
const primaryButton =
  "rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-50 transition-colors";
const secondaryButton =
  "rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-100 disabled:opacity-50 transition-colors";

const labels: Record<StepUpMethod, string> = {
  password: "Password",
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
  const [method, setMethod] = createSignal<StepUpMethod>("password");
  const [password, setPassword] = createSignal("");
  const [code, setCode] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  const [pending, setPending] = createSignal(false);

  const request = pendingStepUp;
  const available = createMemo(() => request()?.methods ?? []);

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
      const grant = await performStepUp(current.action, method(), {
        password: password(),
        code: code(),
      });
      rememberStepUpGrant(current.action, grant.grant, grant.expiresAtMillis);
      completeStepUp(grant.grant);
      setPassword("");
      setCode("");
    } catch (cause) {
      setError(errorMessage(cause, "We couldn't confirm that action. Try again."));
    } finally {
      setPending(false);
    }
  };

  const close = () => {
    setPassword("");
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
              <DialogTitle class="text-base font-semibold text-stone-900">
                Confirm it's you
              </DialogTitle>
              <DialogDescription class="mt-1 text-sm text-stone-600">
                For your security, confirm your identity to {stepUpActionLabel(current().action)}.
              </DialogDescription>

              <div class="mt-4 flex flex-wrap gap-2 text-xs">
                <For each={available()}>
                  {(item) => (
                    <button
                      type="button"
                      class={`rounded-md px-2.5 py-1.5 font-medium transition-colors ${
                        method() === item
                          ? "bg-stone-900 text-white"
                          : "border border-stone-300 text-stone-700 hover:bg-stone-100"
                      }`}
                      onClick={() => choose(item)}
                    >
                      {labels[item]}
                    </button>
                  )}
                </For>
              </div>

              <form onSubmit={submit} class="mt-4 space-y-3">
                <Show when={method() === "password"}>
                  <div class="space-y-1.5">
                    <label for="step-up-password" class="text-xs font-medium text-stone-700">
                      Current password
                    </label>
                    <input
                      id="step-up-password"
                      type="password"
                      required
                      autocomplete="current-password"
                      value={password()}
                      onInput={(event) => setPassword(event.currentTarget.value)}
                      class={inputClass}
                    />
                  </div>
                </Show>

                <Show when={method() === "totp"}>
                  <div class="space-y-1.5">
                    <label for="step-up-code" class="text-xs font-medium text-stone-700">
                      6-digit authenticator code
                    </label>
                    <input
                      id="step-up-code"
                      required
                      autocomplete="one-time-code"
                      inputmode="numeric"
                      placeholder="000000"
                      value={code()}
                      onInput={(event) => setCode(event.currentTarget.value)}
                      class={inputClass}
                    />
                  </div>
                </Show>

                <Show when={method() === "passkey"}>
                  <p class="text-sm text-stone-600">
                    Use the passkey saved on this device or a nearby device.
                  </p>
                </Show>

                <Show when={error()}>
                  {(message) => <p class="text-sm text-red-600">{message()}</p>}
                </Show>

                <div class="flex gap-2">
                  <button type="submit" class={primaryButton} disabled={pending()}>
                    {pending() ? "Confirming…" : method() === "passkey" ? "Use passkey" : "Confirm"}
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
