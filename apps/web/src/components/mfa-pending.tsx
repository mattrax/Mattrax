import { createSignal, Show } from "solid-js";
import { authClient } from "~/lib/auth";
import { errorMessage } from "~/lib/errors";

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

      <div class="flex gap-2 text-xs">
        <button
          type="button"
          class={`rounded-md px-2.5 py-1.5 font-medium transition-colors ${
            mode() === "totp" ? "bg-stone-900 text-white" : "border border-stone-300 text-stone-700"
          }`}
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
          class={`rounded-md px-2.5 py-1.5 font-medium transition-colors ${
            mode() === "recovery"
              ? "bg-stone-900 text-white"
              : "border border-stone-300 text-stone-700"
          }`}
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
          class={`rounded-md px-2.5 py-1.5 font-medium transition-colors ${
            mode() === "passkey"
              ? "bg-stone-900 text-white"
              : "border border-stone-300 text-stone-700"
          }`}
          onClick={() => {
            setMode("passkey");
            setCode("");
            setError(null);
          }}
        >
          Passkey
        </button>
      </div>

      <form onSubmit={submit} class="space-y-3">
        <Show when={mode() !== "passkey"}>
          <div class="space-y-1.5">
            <label for="mfa-code" class="text-sm font-medium text-stone-700">
              {mode() === "totp" ? "6-digit code" : "One-time recovery code"}
            </label>
            <input
              id="mfa-code"
              required
              autocomplete="one-time-code"
              inputmode={mode() === "totp" ? "numeric" : "text"}
              placeholder={mode() === "totp" ? "000000" : "xxxx-xxxx"}
              value={code()}
              onInput={(event) => setCode(event.currentTarget.value)}
              class="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-center text-lg tracking-[0.3em] text-stone-900 outline-none focus:border-stone-500 focus:ring-2 focus:ring-stone-200 transition-colors"
            />
          </div>
        </Show>
        <Show when={mode() === "passkey"}>
          <p class="text-sm text-stone-600">
            Use the passkey saved on this device or a nearby device.
          </p>
        </Show>
        <Show when={error()}>{(message) => <p class="text-sm text-red-600">{message()}</p>}</Show>
        <button
          type="submit"
          disabled={pending()}
          class="w-full rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-50 transition-colors"
        >
          {pending() ? "Verifying…" : mode() === "passkey" ? "Use passkey" : "Continue"}
        </button>
      </form>
    </div>
  );
}
