import { createSignal, For, onSettled, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import { QrCode } from "~/components/mdm/qr-code";
import { Button } from "~/components/ui/button";
import { CircleAlert, ShieldCheck } from "~/components/ui/icons";
import { authClient } from "~/lib/auth";
import { errorMessage } from "~/lib/errors";
import { cn } from "~/lib/utils";

const inputClass =
  "h-9 w-full min-w-0 rounded-lg border border-input bg-white/[0.02] px-2.5 text-base text-foreground outline-none sm:text-[13px] transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

type PasskeySummary = {
  credentialId: string;
  name: string;
  primarySignIn: boolean;
  createdAtMillis: number;
  lastUsedAtMillis?: number;
};

const formatDate = (millis: number | undefined) =>
  millis === undefined ? "—" : new Date(millis).toLocaleDateString();

/**
 * Account security: authenticator-app enrollment, recovery codes and passkeys.
 * Both factors satisfy multi-factor sign-in; passkeys are phishing-resistant and
 * can be used on their own.
 */
export function AccountSecurity(props: {
  totpEnabled: boolean;
  passkeyEnabled: boolean;
  mfaRequired: boolean;
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

  const [recoveryCodes, setRecoveryCodes] = createSignal<ReadonlyArray<string> | null>(null);
  const [disableCode, setDisableCode] = createSignal("");
  const [disableError, setDisableError] = createSignal<string | null>(null);
  const [disablePending, setDisablePending] = createSignal(false);
  const [regenerateCode, setRegenerateCode] = createSignal("");
  const [regenerateError, setRegenerateError] = createSignal<string | null>(null);
  const [regeneratePending, setRegeneratePending] = createSignal(false);
  const [signedOut, setSignedOut] = createSignal(false);

  const [passkeys, setPasskeys] = createSignal<PasskeySummary[]>([]);
  const [passkeysLoaded, setPasskeysLoaded] = createSignal(false);
  const [passkeyName, setPasskeyName] = createSignal("");
  const [passkeyError, setPasskeyError] = createSignal<string | null>(null);
  const [passkeyPending, setPasskeyPending] = createSignal(false);
  const [removingId, setRemovingId] = createSignal<string | null>(null);

  const loadPasskeys = async () => {
    const result = await authClient.listPasskeys();
    setPasskeysLoaded(true);

    if (result.error || !result.data) {
      setPasskeyError(errorMessage(result.error, "Could not load your passkeys"));

      return;
    }

    setPasskeys(result.data.credentials);
  };

  onSettled(() => {
    void loadPasskeys();
  });

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
      code: disableCode().trim(),
    });

    setDisablePending(false);

    if (result.error) {
      setDisableError(errorMessage(result.error, "That code is not valid. Try the current code."));

      return;
    }

    setDisableCode("");
    setSignedOut(true);
  };

  const regenerate = async (event: SubmitEvent) => {
    event.preventDefault();
    setRegenerateError(null);
    setRegeneratePending(true);

    const result = await authClient.regenerateTotpRecoveryCodes({
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
    setRecoveryCodes(result.data.recoveryCodes);
  };

  const addPasskey = async (event: SubmitEvent) => {
    event.preventDefault();
    setPasskeyError(null);
    setPasskeyPending(true);
    // An account with no passkey (for example an SSO-only member meeting a
    // tenant MFA requirement) cannot step up with one, so the first key is
    // authorised by the session's own fresh evidence.
    const firstPasskey = !props.passkeyEnabled;

    const result = await authClient.addPasskey(passkeyName().trim() || "Passkey", { firstPasskey });

    setPasskeyPending(false);

    if (result.error) {
      setPasskeyError(errorMessage(result.error, "That passkey could not be added."));

      return;
    }

    setPasskeyName("");
    await loadPasskeys();
  };

  const removePasskey = async (credentialId: string) => {
    setPasskeyError(null);
    setRemovingId(credentialId);
    const result = await authClient.removePasskey(credentialId);
    setRemovingId(null);

    if (result.error) {
      setPasskeyError(errorMessage(result.error, "That passkey could not be removed."));

      return;
    }

    // Removal invalidates other sessions, including this one.
    setSignedOut(true);
  };

  const finishSignIn = () => {
    window.location.href = "/login";
  };

  return (
    <section class="rounded-xl border border-white/[0.07] bg-card p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03),0_12px_32px_-24px_rgba(0,0,0,0.9)] sm:p-5">
      <div class="flex items-start gap-3">
        <span class="flex size-8 shrink-0 items-center justify-center rounded-lg border border-white/[0.07] bg-white/[0.04] text-muted-foreground">
          <ShieldCheck class="size-4" />
        </span>
        <div class="min-w-0">
          <h2 class="mb-1 text-[13px] font-semibold text-foreground">
            Passkeys and two-factor authentication
          </h2>
          <p class="text-xs leading-relaxed text-muted-foreground">
            Passkeys are the only way to sign in. Add more than one so you can still get in if a
            device is lost. An authenticator app adds a second layer that a phished passkey alone
            cannot satisfy.
          </p>
        </div>
      </div>

      <Show when={props.mfaRequired && !props.passkeyEnabled}>
        <Banner tone="warning" class="mt-4">
          A tenant you belong to requires multi-factor authentication for every role. Add a passkey
          below to reach it; your account settings stay available until you do.
        </Banner>
      </Show>

      <Show when={passkeysLoaded() && passkeys().length === 1}>
        <Banner tone="warning" class="mt-4">
          This is your only passkey. If you lose this device you cannot sign in. Add a second
          passkey, and know that break-glass recovery needs access to your verified email and — in a
          shared tenant — another owner's approval.
        </Banner>
      </Show>

      <Show when={signedOut()}>
        <div class="mt-4 rounded-lg border border-success/25 bg-success/[0.06] px-3 py-2.5 text-[13px]">
          <p class="font-medium text-foreground">Security settings updated.</p>
          <p class="mt-1 text-xs text-muted-foreground">
            For your security, sign in again with your new factor.
          </p>
          <Button type="button" size="sm" class="mt-3" onClick={finishSignIn}>
            Sign in again
          </Button>
        </div>
      </Show>

      <Show when={recoveryCodes()}>
        {(codes) => (
          <div class="mt-4 rounded-lg border border-warning/25 bg-warning/[0.06] p-3 text-[13px]">
            <p class="font-medium text-foreground">Save these one-time recovery codes now.</p>
            <p class="mt-1 text-xs leading-relaxed text-muted-foreground">
              Each code can be used once if you lose access to your authenticator. They are not
              shown again.
            </p>
            <div class="mt-3 grid grid-cols-2 gap-1 font-mono text-xs">
              <For each={codes()}>
                {(code) => (
                  <span class="rounded-md border border-white/[0.07] bg-black/25 px-2 py-1 text-foreground">
                    {code}
                  </span>
                )}
              </For>
            </div>
          </div>
        )}
      </Show>

      {/* ---- Passkeys ------------------------------------------------------ */}
      <div class="mt-5 border-t border-white/[0.06] pt-4">
        <div class="flex flex-wrap items-start justify-between gap-2">
          <div class="min-w-0">
            <p class="text-[13px] font-medium text-foreground">Passkeys</p>
            <p class="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              Sign in with Face ID, Touch ID, Windows Hello or a security key. Add more than one
              passkey so a lost device cannot lock you out.
            </p>
          </div>
          <Chip tone={props.passkeyEnabled ? "success" : "neutral"}>
            {props.passkeyEnabled ? "Enabled" : "Not set up"}
          </Chip>
        </div>

        <Show
          when={passkeysLoaded() && passkeys().length > 0}
          fallback={
            <p class="mt-3 text-xs text-muted-foreground">No passkeys yet. Add one to sign in.</p>
          }
        >
          <ul class="mt-3 divide-y divide-white/[0.05] rounded-lg border border-white/[0.07]">
            <For each={passkeys()}>
              {(item) => (
                <li class="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                  <div class="min-w-0">
                    <p class="truncate text-[13px] font-medium text-foreground">{item.name}</p>
                    <p class="text-xs text-muted-foreground">
                      Added {formatDate(item.createdAtMillis)} · Last used{" "}
                      {formatDate(item.lastUsedAtMillis)}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    disabled={removingId() === item.credentialId}
                    onClick={() => void removePasskey(item.credentialId)}
                  >
                    {removingId() === item.credentialId ? "Removing…" : "Remove"}
                  </Button>
                </li>
              )}
            </For>
          </ul>
        </Show>

        <form onSubmit={addPasskey} class="mt-3 flex flex-col gap-2 sm:flex-row">
          <input
            class={inputClass}
            aria-label="Passkey name"
            placeholder="Name this passkey (for example, MacBook)"
            value={passkeyName()}
            maxlength={128}
            onInput={(event) => setPasskeyName(event.currentTarget.value)}
          />
          <Button type="submit" class="shrink-0" disabled={passkeyPending() || signedOut()}>
            {passkeyPending() ? "Waiting for your device…" : "Add a passkey"}
          </Button>
        </form>
        <p class="mt-2 text-xs text-muted-foreground">
          Adding or removing a passkey asks you to confirm your identity first.
        </p>
        <Show when={passkeyError()}>
          {(message) => (
            <p role="alert" class="mt-2 text-[13px] text-destructive">
              {message()}
            </p>
          )}
        </Show>
      </div>

      {/* ---- Authenticator app --------------------------------------------- */}
      <div class="mt-5 border-t border-white/[0.06] pt-4">
        <div class="flex flex-wrap items-start justify-between gap-2">
          <div class="min-w-0">
            <p class="text-[13px] font-medium text-foreground">Authenticator app</p>
            <p class="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              A time-based code from an app such as 1Password or Google Authenticator.
            </p>
          </div>
          <Chip tone={props.totpEnabled ? "success" : "neutral"}>
            {props.totpEnabled ? "Enabled" : "Not set up"}
          </Chip>
        </div>

        <Show when={!props.totpEnabled && !signedOut()}>
          <Show
            when={enrollment()}
            fallback={
              <div class="mt-3">
                <Show
                  when={props.passkeyEnabled}
                  fallback={
                    <Banner tone="warning">
                      Add a passkey first. Passkeys are the only sign-in method, so the
                      authenticator app can only be a second layer on top of one.
                    </Banner>
                  }
                >
                  <Button type="button" disabled={enrollPending()} onClick={begin}>
                    {enrollPending() ? "Starting…" : "Enable authenticator app"}
                  </Button>
                </Show>
                <Show when={enrollError()}>
                  {(message) => (
                    <p role="alert" class="mt-2 text-[13px] text-destructive">
                      {message()}
                    </p>
                  )}
                </Show>
              </div>
            }
          >
            {(current) => (
              <div class="mt-3 space-y-4">
                <div class="flex flex-col gap-4 rounded-lg border border-white/[0.07] bg-white/[0.02] p-3 sm:flex-row sm:items-start">
                  <QrCode value={current().uri} label="Authenticator setup QR code" size={144} />
                  <div class="min-w-0 flex-1 space-y-2">
                    <p class="text-[13px] font-medium text-foreground">Scan this QR code</p>
                    <p class="text-xs leading-relaxed text-muted-foreground">
                      Use your authenticator app, or enter this setup key manually:
                    </p>
                    <code class="block break-all rounded-md border border-white/[0.07] bg-black/25 px-3 py-2 font-mono text-xs text-foreground">
                      {current().manualKey}
                    </code>
                  </div>
                </div>
                <form onSubmit={confirm} class="space-y-3">
                  <div class="space-y-1.5">
                    <label
                      for="totp-confirm-code"
                      class="block text-xs font-medium text-muted-foreground"
                    >
                      Enter the 6-digit code from your app
                    </label>
                    <input
                      id="totp-confirm-code"
                      required
                      autocomplete="one-time-code"
                      inputmode="numeric"
                      placeholder="000000"
                      aria-invalid={enrollError() ? "true" : undefined}
                      aria-describedby={enrollError() ? "totp-confirm-error" : undefined}
                      value={enrollCode()}
                      onInput={(event) => setEnrollCode(event.currentTarget.value)}
                      class={inputClass}
                    />
                  </div>
                  <Show when={enrollError()}>
                    {(message) => (
                      <p id="totp-confirm-error" role="alert" class="text-[13px] text-destructive">
                        {message()}
                      </p>
                    )}
                  </Show>
                  <div class="flex flex-wrap gap-2">
                    <Button type="submit" disabled={enrollPending()}>
                      {enrollPending() ? "Confirming…" : "Confirm and enable"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setEnrollment(null);
                        setEnrollCode("");
                        setEnrollError(null);
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </form>
              </div>
            )}
          </Show>
        </Show>

        <Show when={props.totpEnabled && !signedOut()}>
          <div class="mt-3 space-y-5">
            <form onSubmit={regenerate} class="space-y-2">
              <p class="text-[13px] font-medium text-foreground">Regenerate recovery codes</p>
              <p class="text-xs leading-relaxed text-muted-foreground">
                This replaces every existing recovery code. Confirm with your passkey and a current
                authenticator code.
              </p>
              <div class="space-y-2">
                <div class="flex flex-col gap-2 sm:flex-row">
                  <input
                    id="regenerate-code"
                    required
                    autocomplete="one-time-code"
                    inputmode="numeric"
                    placeholder="000000"
                    aria-label="Authenticator code"
                    aria-invalid={regenerateError() ? "true" : undefined}
                    aria-describedby={regenerateError() ? "regenerate-error" : undefined}
                    value={regenerateCode()}
                    onInput={(event) => setRegenerateCode(event.currentTarget.value)}
                    class={inputClass}
                  />
                  <Button
                    type="submit"
                    variant="outline"
                    class="shrink-0"
                    disabled={regeneratePending()}
                  >
                    {regeneratePending() ? "Generating…" : "Regenerate"}
                  </Button>
                </div>
              </div>
              <Show when={regenerateError()}>
                {(message) => (
                  <p id="regenerate-error" role="alert" class="text-[13px] text-destructive">
                    {message()}
                  </p>
                )}
              </Show>
            </form>

            <form onSubmit={disable} class="space-y-2 border-t border-white/[0.06] pt-4">
              <p class="text-[13px] font-medium text-destructive">Disable authenticator app</p>
              <p class="text-xs leading-relaxed text-muted-foreground">
                This removes the second factor and invalidates your sessions. Confirm with your
                passkey and a current authenticator code.
              </p>
              <div class="space-y-2">
                <div class="flex flex-col gap-2 sm:flex-row">
                  <input
                    id="disable-code"
                    required
                    autocomplete="one-time-code"
                    inputmode="numeric"
                    placeholder="000000"
                    aria-label="Authenticator code"
                    aria-invalid={disableError() ? "true" : undefined}
                    aria-describedby={disableError() ? "disable-error" : undefined}
                    value={disableCode()}
                    onInput={(event) => setDisableCode(event.currentTarget.value)}
                    class={inputClass}
                  />
                  <Button
                    type="submit"
                    variant="destructive"
                    class="shrink-0"
                    disabled={disablePending()}
                  >
                    {disablePending() ? "Disabling…" : "Disable"}
                  </Button>
                </div>
              </div>
              <Show when={disableError()}>
                {(message) => (
                  <p id="disable-error" role="alert" class="text-[13px] text-destructive">
                    {message()}
                  </p>
                )}
              </Show>
            </form>
          </div>
        </Show>
      </div>
    </section>
  );
}

const chipTones = {
  neutral: "border-white/[0.08] bg-white/[0.03] text-muted-foreground",
  success: "border-success/25 bg-success/10 text-success-foreground",
  warning: "border-warning/25 bg-warning/10 text-warning-foreground",
  danger: "border-destructive/25 bg-destructive/10 text-destructive",
} as const;

function Chip(props: { tone: keyof typeof chipTones; children: JSX.Element }) {
  return (
    <span
      class={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium",
        chipTones[props.tone],
      )}
    >
      <span class="size-1.5 rounded-full bg-current" aria-hidden="true" />
      {props.children}
    </span>
  );
}

function Banner(props: { tone: "warning"; children: JSX.Element; class?: string }) {
  return (
    <div
      role="status"
      class={cn(
        "flex items-start gap-2 rounded-lg border border-warning/25 bg-warning/[0.06] px-3 py-2 text-xs leading-relaxed text-warning-foreground",
        props.class,
      )}
    >
      <CircleAlert class="mt-px size-3.5 shrink-0" />
      <span>{props.children}</span>
    </div>
  );
}
