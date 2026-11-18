import { createSignal, onCleanup, onSettled, Show } from "solid-js";
import type { Schema } from "effect";
import { authClient } from "~/lib/auth";
import { Button } from "~/components/ui/button";
import { errorMessage, raisedFailure } from "~/lib/errors";

/** Inline alerts arrive with a short rise so the state change is legible. */
const feedbackEnter = "motion-safe:animate-[mt-rise-in_160ms_var(--ease-swift)_both]";

/**
 * Six-digit email verification shared by registration and the standalone
 * verification screen. Codes are single-use and expire after 15 minutes.
 */
export function EmailCodeForm(props: {
  email: string;
  /** Send a code as soon as the form mounts. */
  autoSend?: boolean;
  /** A code was already sent by the caller (registration does this). */
  sentInitially?: boolean;
  /** Signed challenge that belongs to the initially sent code. */
  initialChallenge?: string;
  /** A failure from the caller's initial send attempt. */
  initialError?: string | null;
  /**
   * Override the signed-in account verification flow (guest sign-up). The
   * request resolves with the challenge to send back on verify; the verify
   * result is handed to `onVerified`.
   */
  requestCode?: () => Promise<{ challenge?: string; error?: { message?: string } }>;
  verifyCode?: (
    code: string,
    challenge: string,
  ) => Promise<{ result?: Schema.Json; error?: { message?: string } }>;
  submitLabel?: string;
  onVerified: (result?: Schema.Json) => void | Promise<void>;
  onBack?: () => void;
  backLabel?: string;
}) {
  const [challenge, setChallenge] = createSignal(props.initialChallenge ?? "");
  const [code, setCode] = createSignal("");
  const [pending, setPending] = createSignal(false);
  const [sending, setSending] = createSignal(false);
  const [error, setError] = createSignal<string | null>(props.initialError ?? null);

  const [notice, setNotice] = createSignal<string | null>(
    props.sentInitially ? "A verification code is on its way." : null,
  );

  const [cooldown, setCooldown] = createSignal(props.sentInitially ? 30 : 0);
  let timer: ReturnType<typeof setInterval> | undefined;

  const startCooldown = () => {
    clearInterval(timer);
    setCooldown(30);
    timer = setInterval(() => {
      setCooldown((value) => {
        if (value <= 1) {
          clearInterval(timer);

          return 0;
        }

        return value - 1;
      });
    }, 1000);
  };

  onCleanup(() => clearInterval(timer));

  const send = async () => {
    if (sending() || cooldown() > 0) return;
    setSending(true);
    setError(null);
    setNotice(null);
    let nextChallenge = "";

    if (props.requestCode) {
      const result = await props.requestCode();

      if (result.error) {
        setSending(false);
        setError(result.error.message ?? "Could not send a verification code.");

        return;
      }

      nextChallenge = result.challenge ?? "";
    } else {
      const result = await authClient.requestEmailVerification();

      if (result.error) {
        setSending(false);
        setError(result.error.message ?? "Could not send a verification code.");

        return;
      }

      nextChallenge = result.data?.challenge ?? "";
    }

    setSending(false);
    setChallenge(nextChallenge);
    setNotice("A new verification code has been sent.");
    startCooldown();
  };

  onSettled(() => {
    if (props.autoSend) void send();
    else if (props.sentInitially) startCooldown();
  });

  const submit = async (event: SubmitEvent) => {
    event.preventDefault();
    setError(null);
    setNotice(null);

    if (!/^\d{6}$/.test(code())) {
      setError("Enter the six-digit code from the email.");

      return;
    }

    if (!props.verifyCode && !challenge()) {
      setError("Request a code, then enter the six digits from the email.");

      return;
    }

    setPending(true);

    try {
      let verified: Schema.Json | undefined;

      if (props.verifyCode) {
        const result = await props.verifyCode(code(), challenge());

        if (result.error) {
          setError(result.error.message ?? "That code is invalid or has expired.");

          return;
        }

        verified = result.result;
      } else {
        const result = await authClient.verifyEmail({ code: code(), challenge: challenge() });

        if (result.error) {
          setError(result.error.message ?? "That code is invalid or has expired.");

          return;
        }

        verified = result.data;
      }

      await props.onVerified(verified);
    } catch (cause) {
      setError(errorMessage(raisedFailure(cause), "That code is invalid or has expired."));
    } finally {
      setPending(false);
    }
  };

  return (
    <div class="space-y-5">
      <div class="text-center">
        <h1 class="text-2xl font-semibold text-stone-900">Verify your email</h1>
        <p class="mt-1 text-sm text-stone-500">
          Enter the six-digit code we sent to{" "}
          <span class="font-medium text-stone-700">{props.email}</span>.
        </p>
      </div>

      <form onSubmit={submit} class="space-y-4">
        <div class="space-y-1.5">
          <label for="verification-code" class="text-sm font-medium text-stone-700">
            Verification code
          </label>
          <input
            id="verification-code"
            type="text"
            inputmode="numeric"
            autocomplete="one-time-code"
            pattern="[0-9]{6}"
            maxlength="6"
            required
            autofocus
            placeholder="000000"
            aria-invalid={error() ? "true" : undefined}
            aria-describedby={error() ? "verification-code-error" : undefined}
            value={code()}
            onInput={(event) => setCode(event.currentTarget.value.replace(/\D/g, "").slice(0, 6))}
            class="w-full rounded-lg border border-input bg-card px-3 py-2.5 text-center text-2xl tracking-[0.4em] text-foreground placeholder:tracking-[0.4em] placeholder:text-muted-foreground/60 outline-none focus:border-ring focus:ring-2 focus:ring-ring/30 transition-colors"
          />
        </div>

        <Show when={error()}>
          {(message) => (
            <p
              id="verification-code-error"
              role="alert"
              class={`text-sm text-red-600 ${feedbackEnter}`}
            >
              {message()}
            </p>
          )}
        </Show>
        <Show when={notice()}>
          {(message) => (
            <p role="status" class={`text-sm text-emerald-600 ${feedbackEnter}`}>
              {message()}
            </p>
          )}
        </Show>

        <Button type="submit" class="h-9 w-full text-sm" pending={pending()}>
          {pending() ? "Verifying…" : (props.submitLabel ?? "Verify email")}
        </Button>
      </form>

      <div class="flex items-center justify-between gap-3 text-xs text-stone-500">
        <button
          type="button"
          onClick={() => void send()}
          disabled={sending() || cooldown() > 0}
          class="font-medium text-stone-700 underline underline-offset-2 transition-colors duration-[var(--duration-hover)] ease-swift hover:text-stone-900 disabled:no-underline disabled:opacity-60"
        >
          <span>
            {sending()
              ? "Sending…"
              : cooldown() > 0
                ? `Resend code in ${cooldown()}s`
                : "Resend code"}
          </span>
          <span class="sr-only" aria-live="polite">
            {sending() ? "Sending a new code" : ""}
          </span>
        </button>
        <Show when={props.onBack}>
          <button
            type="button"
            onClick={() => props.onBack?.()}
            class="font-medium text-stone-700 underline underline-offset-2 transition-colors duration-[var(--duration-hover)] ease-swift hover:text-stone-900"
          >
            {props.backLabel ?? "Back"}
          </button>
        </Show>
      </div>
    </div>
  );
}
