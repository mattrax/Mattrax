import { createSignal, Show } from "solid-js";
import { Match as EffectMatch } from "effect";
import { authClient } from "~/lib/auth";
import { Button } from "~/components/ui/button";
import { errorMessage } from "~/lib/errors";

/** Inline alerts arrive with a short rise so the state change is legible. */
const feedbackEnter = "motion-safe:animate-[mt-rise-in_160ms_var(--ease-swift)_both]";

const modeButton = (active: boolean) =>
  `rounded-md px-2.5 py-1.5 font-medium transition-colors duration-[var(--duration-hover)] ease-swift ${
    active
      ? "bg-primary text-primary-foreground"
      : "border border-stone-300 text-stone-700 hover:bg-stone-100 hover:text-stone-900"
  }`;

/**
 * Completes a pending sign-in with an authenticator code or a one-time recovery
 * code. The pending credential stays in its httpOnly cookie; only the code is
 * sent to the API.
 */
export function MfaPending(props: { email?: string; onComplete: () => void }) {
  const [mode, setMode] = createSignal<"totp" | "recovery" | "passkey">("totp");
  const [code, setCode] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  const [pending, setPending] = createSignal(false);

  const modeLabel = () =>
    EffectMatch.value(mode()).pipe(
      EffectMatch.when("totp", () => "Using an authenticator code."),
      EffectMatch.when("recovery", () => "Using a recovery code."),
      EffectMatch.orElse(() => "Using a passkey."),
    );

  const submit = async (event: SubmitEvent) => {
    event.preventDefault();
    setError(null);
    setPending(true);

    if (mode() === "passkey") {
      const result = await authClient.passkeyPending();
      setPending(false);

      if (result.error) {
        setError(errorMessage(result.error, "That passkey wasn't accepted"));

        return;
      }

      props.onComplete();

      return;
    }

    const result =
      mode() === "totp"
        ? await authClient.verifyTotpPending(code().trim())
        : await authClient.recoverTotpPending(code().trim());

    setPending(false);

    if (result.error) {
      setError(
        errorMessage(
          result.error,
          mode() === "totp"
            ? "That authenticator code is not valid"
            : "That recovery code is not valid",
        ),
      );

      return;
    }

    props.onComplete();
  };

  return (
    <div class="space-y-4">
      <div class="rounded-lg border border-stone-200 bg-stone-50 p-3 text-sm text-stone-600">
        <p class="font-medium text-stone-900">Two-factor authentication required</p>
        <p class="mt-1">
          <Show when={props.email} fallback="Enter a code from your authenticator app to continue.">
            Enter a code from the authenticator app for <strong>{props.email}</strong>.
          </Show>
        </p>
      </div>

      <div role="group" aria-label="Verification method" class="flex gap-2 text-xs">
        <button
          type="button"
          aria-pressed={mode() === "totp" ? "true" : "false"}
          class={modeButton(mode() === "totp")}
          onClick={() => {
            setMode("totp");
            setCode("");
            setError(null);
          }}
        >
          Authenticator code
        </button>
        <button
          type="button"
          aria-pressed={mode() === "recovery" ? "true" : "false"}
          class={modeButton(mode() === "recovery")}
          onClick={() => {
            setMode("recovery");
            setCode("");
            setError(null);
          }}
        >
          Recovery code
        </button>
        <button
          type="button"
          aria-pressed={mode() === "passkey" ? "true" : "false"}
          class={modeButton(mode() === "passkey")}
          onClick={() => {
            setMode("passkey");
            setCode("");
            setError(null);
          }}
        >
          Passkey
        </button>
      </div>

      <p role="status" aria-live="polite" class="sr-only">
        {modeLabel()}
      </p>

      <form onSubmit={submit} class="space-y-3">
        <Show when={mode() !== "passkey"}>
          <div class="space-y-1.5">
            <label for="mfa-code" class="text-sm font-medium text-stone-700">
              {mode() === "totp" ? "6-digit code" : "One-time recovery code"}
            </label>
            <input
              id="mfa-code"
              aria-invalid={error() ? "true" : undefined}
              aria-describedby={error() ? "mfa-error" : undefined}
              required
              autocomplete="one-time-code"
              inputmode={mode() === "totp" ? "numeric" : "text"}
              placeholder={mode() === "totp" ? "000000" : "xxxx-xxxx"}
              value={code()}
              onInput={(event) => setCode(event.currentTarget.value)}
              class="w-full rounded-lg border border-input bg-card px-3 py-2 text-center text-lg tracking-[0.3em] text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/30 transition-colors"
            />
          </div>
        </Show>
        <Show when={mode() === "passkey"}>
          <p class="text-sm text-stone-600">
            Use the passkey saved on this device or a nearby device.
          </p>
        </Show>
        <Show when={error()}>
          {(message) => (
            <p id="mfa-error" role="alert" class={`text-sm text-destructive ${feedbackEnter}`}>
              {message()}
            </p>
          )}
        </Show>
        <Button type="submit" class="h-9 w-full text-sm" pending={pending()}>
          {pending() ? "Verifying…" : mode() === "passkey" ? "Use passkey" : "Continue"}
        </Button>
      </form>
    </div>
  );
}
