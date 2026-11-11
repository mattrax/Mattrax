import { createSignal, For, Show } from "solid-js";
import { QrCode } from "~/components/mdm/qr-code";
import { authClient } from "~/lib/auth";
import { errorMessage } from "~/lib/errors";

const inputClass =
  "w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 outline-none focus:border-stone-500 focus:ring-2 focus:ring-stone-200 transition-colors";
const primaryButton =
  "rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-50 transition-colors";
const secondaryButton =
  "rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-100 disabled:opacity-50 transition-colors";

/**
 * Authenticator-app enrollment and recovery-code management. Enrollment and
 * disabling invalidate the current session, so the card finishes by asking the
 * user to sign in again with their new factor.
 */
export function AccountSecurity(props: {
  mfaEnabled: boolean;
  mfaRequired: boolean;
  hasPassword: boolean;
  email: string;
}) {
  const [enrollment, setEnrollment] = createSignal<{
    enrollmentId: string;
    manualKey: string;
    uri: string;
    expiresAtMillis: number;
  } | null>(null);
  const [enrollCode, setEnrollCode] = createSignal("");
  const [enrollError, setEnrollError] = createSignal<string | null>(null);
  const [enrollPending, setEnrollPending] = createSignal(false);

  const [recoveryCodes, setRecoveryCodes] = createSignal<string[] | null>(null);
  const [disableCode, setDisableCode] = createSignal("");
  const [disablePassword, setDisablePassword] = createSignal("");
  const [disableError, setDisableError] = createSignal<string | null>(null);
  const [disablePending, setDisablePending] = createSignal(false);
  const [regenerateCode, setRegenerateCode] = createSignal("");
  const [regeneratePassword, setRegeneratePassword] = createSignal("");
  const [regenerateError, setRegenerateError] = createSignal<string | null>(null);
  const [regeneratePending, setRegeneratePending] = createSignal(false);
  const [signedOut, setSignedOut] = createSignal(false);

  const begin = async () => {
    setEnrollError(null);
    setRecoveryCodes(null);
    setEnrollPending(true);
    const result = await authClient.beginTotpEnrollment(props.email);
    setEnrollPending(false);
    if (result.error || !result.data) {
      setEnrollError(errorMessage(result.error, "Could not start authenticator setup"));
      return;
    }
    setEnrollment(result.data);
  };

  const confirm = async (event: SubmitEvent) => {
    event.preventDefault();
    const current = enrollment();
    if (!current) return;
    setEnrollError(null);
    setEnrollPending(true);
    const result = await authClient.confirmTotpEnrollment({
      enrollmentId: current.enrollmentId,
      code: enrollCode().trim(),
    });
    setEnrollPending(false);
    if (result.error || !result.data) {
      setEnrollError(errorMessage(result.error, "That code is not valid. Try the current code."));
      return;
    }
    setEnrollment(null);
    setEnrollCode("");
    setRecoveryCodes(result.data.recoveryCodes);
    setSignedOut(true);
  };

  const disable = async (event: SubmitEvent) => {
    event.preventDefault();
    setDisableError(null);
    setDisablePending(true);
    const result = await authClient.disableTotp({
      password: disablePassword(),
      code: disableCode().trim(),
    });
    setDisablePending(false);
    if (result.error) {
      setDisableError(errorMessage(result.error, "That code is not valid. Try the current code."));
      return;
    }
    setDisableCode("");
    setDisablePassword("");
    setSignedOut(true);
  };

  const regenerate = async (event: SubmitEvent) => {
    event.preventDefault();
    setRegenerateError(null);
    setRegeneratePending(true);
    const result = await authClient.regenerateTotpRecoveryCodes({
      password: regeneratePassword(),
      code: regenerateCode().trim(),
    });
    setRegeneratePending(false);
    if (result.error || !result.data) {
      setRegenerateError(
        errorMessage(result.error, "That code is not valid. Try the current code."),
      );
      return;
    }
    setRegenerateCode("");
    setRegeneratePassword("");
    setRecoveryCodes(result.data.recoveryCodes);
  };

  const finishSignIn = () => {
    window.location.href = "/login";
  };

  return (
    <section class="rounded-xl border border-border bg-card p-6">
      <h2 class="text-sm font-semibold mb-1">Multi-factor authentication</h2>
      <p class="text-sm text-muted-foreground mb-4">
        Add an authenticator app as a second factor. Once enabled, signing in requires your password
        and a current code.
      </p>

      <Show when={props.mfaRequired && !props.mfaEnabled}>
        <div class="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          A workspace where you are an owner or admin requires MFA. Enable an authenticator to
          regain access to its settings.
        </div>
      </Show>

      <Show when={signedOut()}>
        <div class="mb-4 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
          <p class="font-medium">Security settings updated.</p>
          <p class="mt-1">For your security, sign in again with your new factor.</p>
          <button type="button" class={`${primaryButton} mt-3`} onClick={finishSignIn}>
            Sign in again
          </button>
        </div>
      </Show>

      <Show when={recoveryCodes()}>
        {(codes) => (
          <div class="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <p class="font-medium">Save these one-time recovery codes now.</p>
            <p class="mt-1 text-xs">
              Each code can be used once if you lose access to your authenticator. They are not
              shown again.
            </p>
            <div class="mt-3 grid grid-cols-2 gap-1 font-mono text-xs">
              <For each={codes()}>
                {(code) => <span class="rounded bg-white px-2 py-1">{code}</span>}
              </For>
            </div>
          </div>
        )}
      </Show>

      <Show when={!props.mfaEnabled && !signedOut()}>
        <Show
          when={enrollment()}
          fallback={
            <div>
              <Show
                when={props.hasPassword}
                fallback={
                  <div class="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    Set a password for this account before enabling an authenticator app. Password
                    and authenticator are required together; passwordless or SSO-only accounts
                    cannot complete MFA sign-in.
                  </div>
                }
              >
                <button
                  type="button"
                  class={primaryButton}
                  disabled={enrollPending()}
                  onClick={begin}
                >
                  {enrollPending() ? "Starting…" : "Enable authenticator app"}
                </button>
              </Show>
              <Show when={enrollError()}>
                {(message) => <p class="mt-2 text-sm text-red-600">{message()}</p>}
              </Show>
            </div>
          }
        >
          {(current) => (
            <div class="space-y-4">
              <div class="flex flex-col gap-4 sm:flex-row sm:items-start">
                <QrCode value={current().uri} label="Authenticator setup QR code" />
                <div class="min-w-0 flex-1 space-y-2 text-sm">
                  <p class="font-medium text-stone-900">Scan this QR code</p>
                  <p class="text-muted-foreground">
                    Use your authenticator app, or enter this setup key manually:
                  </p>
                  <code class="block break-all rounded-lg border bg-stone-50 px-3 py-2 font-mono text-xs">
                    {current().manualKey}
                  </code>
                </div>
              </div>
              <form onSubmit={confirm} class="space-y-3">
                <div class="space-y-1.5">
                  <label for="totp-confirm-code" class="text-xs font-medium text-stone-700">
                    Enter the 6-digit code from your app
                  </label>
                  <input
                    id="totp-confirm-code"
                    required
                    autocomplete="one-time-code"
                    inputmode="numeric"
                    placeholder="000000"
                    value={enrollCode()}
                    onInput={(event) => setEnrollCode(event.currentTarget.value)}
                    class={inputClass}
                  />
                </div>
                <Show when={enrollError()}>
                  {(message) => <p class="text-sm text-red-600">{message()}</p>}
                </Show>
                <div class="flex gap-2">
                  <button type="submit" class={primaryButton} disabled={enrollPending()}>
                    {enrollPending() ? "Confirming…" : "Confirm and enable"}
                  </button>
                  <button
                    type="button"
                    class={secondaryButton}
                    onClick={() => {
                      setEnrollment(null);
                      setEnrollCode("");
                      setEnrollError(null);
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          )}
        </Show>
      </Show>

      <Show when={props.mfaEnabled && !signedOut()}>
        <div class="space-y-5">
          <div class="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
            Authenticator app enabled. Recovery codes are active.
          </div>

          <form onSubmit={regenerate} class="space-y-2">
            <p class="text-sm font-medium text-stone-900">Regenerate recovery codes</p>
            <p class="text-xs text-muted-foreground">
              This replaces every existing recovery code. Enter your current password and an
              authenticator code to confirm.
            </p>
            <input
              type="password"
              required
              autocomplete="current-password"
              placeholder="Current password"
              value={regeneratePassword()}
              onInput={(event) => setRegeneratePassword(event.currentTarget.value)}
              class={inputClass}
            />
            <div class="flex gap-2">
              <input
                required
                autocomplete="one-time-code"
                inputmode="numeric"
                placeholder="000000"
                value={regenerateCode()}
                onInput={(event) => setRegenerateCode(event.currentTarget.value)}
                class={inputClass}
              />
              <button type="submit" class={secondaryButton} disabled={regeneratePending()}>
                {regeneratePending() ? "Generating…" : "Regenerate"}
              </button>
            </div>
            <Show when={regenerateError()}>
              {(message) => <p class="text-sm text-red-600">{message()}</p>}
            </Show>
          </form>

          <form onSubmit={disable} class="space-y-2 border-t pt-4">
            <p class="text-sm font-medium text-red-700">Disable authenticator app</p>
            <p class="text-xs text-muted-foreground">
              This removes the second factor and invalidates your sessions. Enter your current
              password and an authenticator code to confirm.
            </p>
            <input
              type="password"
              required
              autocomplete="current-password"
              placeholder="Current password"
              value={disablePassword()}
              onInput={(event) => setDisablePassword(event.currentTarget.value)}
              class={inputClass}
            />
            <div class="flex gap-2">
              <input
                required
                autocomplete="one-time-code"
                inputmode="numeric"
                placeholder="000000"
                value={disableCode()}
                onInput={(event) => setDisableCode(event.currentTarget.value)}
                class={inputClass}
              />
              <button
                type="submit"
                class="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 transition-colors whitespace-nowrap"
                disabled={disablePending()}
              >
                {disablePending() ? "Disabling…" : "Disable"}
              </button>
            </div>
            <Show when={disableError()}>
              {(message) => <p class="text-sm text-red-600">{message()}</p>}
            </Show>
          </form>
        </div>
      </Show>
    </section>
  );
}
