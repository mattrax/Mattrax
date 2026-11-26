import { createSignal, Show } from "solid-js";
import { Match as EffectMatch } from "effect";
import { authClient } from "~/lib/auth";
import { Button } from "~/components/ui/button";
import { errorMessage } from "~/lib/errors";
import { Input } from "~/components/ui/input";

/** Inline alerts arrive with a short rise so the state change is legible. */
const feedbackEnter = "motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-1 motion-safe:duration-150";

/**
 * Completes a pending sign-in with an authenticator code or a one-time recovery
 * code. The pending credential stays in its httpOnly cookie; only the code is
 * sent to the API.
 */
export default function MfaPending(props: { email?: string; onComplete: () => void }) {
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
      <div class="rounded-lg border border-border bg-page p-3 text-sm text-subtle-foreground">
        <p class="font-medium text-foreground">Two-factor authentication required</p>
        <p class="mt-1">
          <Show when={props.email} fallback="Enter a code from your authenticator app to continue.">
            Enter a code from the authenticator app for <strong>{props.email}</strong>.
          </Show>
        </p>
      </div>

      <div role="group" aria-label="Verification method" class="flex gap-2 text-xs">
        <Button
          type="button"
          aria-pressed={mode() === "totp" ? "true" : "false"}
          variant={mode() === "totp" ? "default" : "outline"}
          size="sm"
          onClick={() => {
            setMode("totp");
            setCode("");
            setError(null);
          }}
        >
          Authenticator code
        </Button>
        <Button
          type="button"
          aria-pressed={mode() === "recovery" ? "true" : "false"}
          variant={mode() === "recovery" ? "default" : "outline"}
          size="sm"
          onClick={() => {
            setMode("recovery");
            setCode("");
            setError(null);
          }}
        >
          Recovery code
        </Button>
        <Button
          type="button"
          aria-pressed={mode() === "passkey" ? "true" : "false"}
          variant={mode() === "passkey" ? "default" : "outline"}
          size="sm"
          onClick={() => {
            setMode("passkey");
            setCode("");
            setError(null);
          }}
        >
          Passkey
        </Button>
      </div>

      <p role="status" aria-live="polite" class="sr-only">
        {modeLabel()}
      </p>

      <form onSubmit={submit} class="space-y-3">
        <Show when={mode() !== "passkey"}>
          <div class="space-y-1.5">
            <label for="mfa-code" class="text-sm font-medium text-muted-foreground">
              {mode() === "totp" ? "6-digit code" : "One-time recovery code"}
            </label>
            <Input
              id="mfa-code"
              aria-invalid={error() ? "true" : undefined}
              aria-describedby={error() ? "mfa-error" : undefined}
              required
              autocomplete="one-time-code"
              inputmode={mode() === "totp" ? "numeric" : "text"}
              placeholder={mode() === "totp" ? "000000" : "xxxx-xxxx"}
              value={code()}
              onInput={(event) => setCode(event.currentTarget.value)}
              class="w-full text-center"
            />
          </div>
        </Show>
        <Show when={mode() === "passkey"}>
          <p class="text-sm text-subtle-foreground">
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
        <Button type="submit" class="h-9 w-full" pending={pending()}>
          {pending() ? "Verifying…" : mode() === "passkey" ? "Use passkey" : "Continue"}
        </Button>
      </form>
    </div>
  );
}
