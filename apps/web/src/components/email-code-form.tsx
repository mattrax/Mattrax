import { createSignal, onCleanup, onSettled, Show } from "solid-js";
import { authClient } from "~/lib/auth";
import { Button } from "@mattrax/ui";
import EmailCodeField from "~/components/email-code-field";
import { errorMessage, raisedFailure } from "~/lib/errors";

/** Inline alerts arrive with a short rise so the state change is legible. */
const feedbackEnter = "motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-1 motion-safe:duration-150";

/** Seconds before the address can ask for another code. */
const RESEND_COOLDOWN_SECONDS = 30;

/**
 * The signed-in email verification step. A code is requested on mount and the
 * address can ask for another after a short cooldown; codes are single-use and
 * expire after 15 minutes.
 */
export default function EmailCodeForm(props: { email: string; onVerified: () => void | Promise<void> }) {
  const [challenge, setChallenge] = createSignal("");
  const [code, setCode] = createSignal("");
  const [pending, setPending] = createSignal(false);
  const [sending, setSending] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [notice, setNotice] = createSignal<string | null>(null);
  const [cooldown, setCooldown] = createSignal(0);

  let timer: ReturnType<typeof setInterval> | undefined;
  let codeField: HTMLInputElement | undefined;
  /** The last value an input event submitted, so it cannot submit twice. */
  let submittedCode: string | null = null;

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
      // A new code replaces the old one: empty the field so the digits for this
      // message can be typed or autofilled into a clean input.
      submittedCode = null;
      setCode("");
      codeField?.focus();
      // Say when the mail is still queued rather than promising it arrived.
      setNotice(
        result.data?.emailSent === false
          ? "We couldn't send that email just now. Try again in a moment."
          : options.resend
            ? "A new verification code has been sent."
            : "A verification code is on its way.",
      );
      startCooldown();
    } catch (error_) {
      setError(errorMessage(raisedFailure(error_), "Could not send a verification code."));
    } finally {
      setSending(false);
    }
  };

  onSettled(() => {
    // The code is the only thing to type here; put the caret in it.
    codeField?.focus();
    void send();
  });

  const submitCode = async (value: string) => {
    setError(null);
    setNotice(null);

    if (!/^\d{6}$/.test(value)) {
      setError("Enter the six-digit code from the email.");

      return;
    }

    if (!challenge()) {
      setError("Request a code, then enter the six digits from the email.");

      return;
    }

    setPending(true);

    try {
      const result = await authClient.verifyEmail({ code: value, challenge: challenge() });

      if (result.error) {
        setError(result.error.message ?? "That code is invalid or has expired.");

        return;
      }

      await props.onVerified();
    } catch (error_) {
      setError(errorMessage(raisedFailure(error_), "That code is invalid or has expired."));
    } finally {
      setPending(false);
    }
  };

  /**
   * Six digits is a complete code, so it is sent as soon as it appears — typed,
   * pasted or filled by the OS autofill — rather than waiting for a button.
   * The guard stops a repeated input event from submitting the same code twice.
   */
  const updateCode = (value: string) => {
    setCode(value);

    if (value.length !== 6 || pending() || sending() || value === submittedCode) return;

    if (!challenge()) return;

    submittedCode = value;
    void submitCode(value);
  };

  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    void submitCode(code());
  };

  return (
    <div class="space-y-5">
      <div class="text-center">
        <h1 class="text-2xl font-semibold text-foreground">Verify your email</h1>
        <p class="mt-1 text-sm text-muted-foreground">
          Enter the six-digit code we sent to{" "}
          <span class="font-medium text-muted-foreground">{props.email}</span>.
        </p>
      </div>

      <form onSubmit={submit} class="space-y-4">
        <div class="space-y-1.5">
          <EmailCodeField
            value={code()}
            onInput={updateCode}
            invalid={error() !== null}
            describedBy={error() ? "verification-code-error" : undefined}
            inputRef={(input) => (codeField = input)}
          />
          <div class="flex items-center justify-end">
            <Button
              type="button"
              variant="link"
              size="xs"
              onClick={() => void send({ resend: true })}
              disabled={sending() || cooldown() > 0}
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
            </Button>
          </div>
        </div>

        <Show when={error()}>
          {(message) => (
            <p
              id="verification-code-error"
              role="alert"
              class={`text-sm text-destructive ${feedbackEnter}`}
            >
              {message()}
            </p>
          )}
        </Show>
        <Show when={notice()}>
          {(message) => (
            <p role="status" class={`text-sm text-success ${feedbackEnter}`}>
              {message()}
            </p>
          )}
        </Show>

        <Button type="submit" class="h-9 w-full" pending={pending()}>
          {pending() ? "Verifying…" : "Verify email"}
        </Button>
      </form>
    </div>
  );
}
