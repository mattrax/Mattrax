import { createSignal, onCleanup, onSettled, Show } from "solid-js";
import { authClient } from "~/lib/auth";
import { Button } from "~/components/ui/button";
import { EmailCodeField } from "~/components/email-code-field";
import { errorMessage, raisedFailure } from "~/lib/errors";

/** Inline alerts arrive with a short rise so the state change is legible. */
const feedbackEnter = "motion-safe:animate-[mt-rise-in_160ms_var(--ease-swift)_both]";

/** Seconds before the address can ask for another code. */
const RESEND_COOLDOWN_SECONDS = 30;

/**
 * The signed-in email verification step. A code is requested on mount and the
 * address can ask for another after a short cooldown; codes are single-use and
 * expire after 15 minutes.
 */
export function EmailCodeForm(props: { email: string; onVerified: () => void | Promise<void> }) {
  const [challenge, setChallenge] = createSignal("");
  const [code, setCode] = createSignal("");
  const [pending, setPending] = createSignal(false);
  const [sending, setSending] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [notice, setNotice] = createSignal<string | null>(null);
  const [cooldown, setCooldown] = createSignal(0);

  let timer: ReturnType<typeof setInterval> | undefined;
  let codeField: HTMLInputElement | undefined;

  const startCooldown = () => {
    clearInterval(timer);
    setCooldown(RESEND_COOLDOWN_SECONDS);
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

  const send = async (options: { readonly resend?: boolean } = {}) => {
    if (sending() || (options.resend && cooldown() > 0)) return;
    setSending(true);
    setError(null);
    setNotice(null);

    try {
      const result = await authClient.requestEmailVerification();

      if (result.error) {
        setError(result.error.message ?? "Could not send a verification code.");

        return;
      }

      setChallenge(result.data?.challenge ?? "");
      // Say when the mail is still queued rather than promising it arrived.
      setNotice(
        result.data?.emailSent === false
          ? "We couldn't send that email just now. Try again in a moment."
          : options.resend
            ? "A new verification code has been sent."
            : "A verification code is on its way.",
      );
      startCooldown();
    } catch (cause) {
      setError(errorMessage(raisedFailure(cause), "Could not send a verification code."));
    } finally {
      setSending(false);
    }
  };

  onSettled(() => {
    // The code is the only thing to type here; put the caret in it.
    codeField?.focus();
    void send();
  });

  const submit = async (event: SubmitEvent) => {
    event.preventDefault();
    setError(null);
    setNotice(null);

    if (!/^\d{6}$/.test(code())) {
      setError("Enter the six-digit code from the email.");

      return;
    }

    if (!challenge()) {
      setError("Request a code, then enter the six digits from the email.");

      return;
    }

    setPending(true);

    try {
      const result = await authClient.verifyEmail({ code: code(), challenge: challenge() });

      if (result.error) {
        setError(result.error.message ?? "That code is invalid or has expired.");

        return;
      }

      await props.onVerified();
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
          <EmailCodeField
            value={code()}
            onInput={setCode}
            invalid={error() !== null}
            describedBy={error() ? "verification-code-error" : undefined}
            inputRef={(input) => (codeField = input)}
          />
          <div class="flex items-center justify-end">
            <button
              type="button"
              onClick={() => void send({ resend: true })}
              disabled={sending() || cooldown() > 0}
              class="text-xs font-medium text-stone-700 underline underline-offset-2 transition-colors duration-[var(--duration-hover)] ease-swift hover:text-stone-900 disabled:no-underline disabled:opacity-60"
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
          </div>
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
          {pending() ? "Verifying…" : "Verify email"}
        </Button>
      </form>
    </div>
  );
}
