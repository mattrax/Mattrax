import { Title } from "@solidjs/meta";
import { BrandLogo } from "~/components/brand-logo";
import { useSearchParams } from "@solidjs/router";
import { useNavigate } from "~/lib/navigation";
import { createSignal, onCleanup, onSettled, Show } from "solid-js";
import { Schema } from "effect";
import { authClient } from "~/lib/auth";
import { Button } from "~/components/ui/button";
import { EmailCodeField } from "~/components/email-code-field";
import { errorMessage, raisedFailure } from "~/lib/errors";

/** Inline alerts arrive with a short rise so the state change is legible. */
const feedbackEnter = "motion-safe:animate-[mt-rise-in_160ms_var(--ease-swift)_both]";

/** Seconds before the address can ask for another code. */
const RESEND_COOLDOWN_SECONDS = 30;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const fieldClass =
  "w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/30 transition-colors";

/**
 * Sign-up proves the email address before it creates anything: the code form
 * issues and checks a guest challenge, then the passkey ceremony creates the
 * account with a verified address. No callback page or email link is needed.
 *
 * Name, email and code share one screen. Sending the code only reveals the last
 * field instead of moving to a second page, so the details a person just typed
 * stay in view while they read the email.
 */
export default function RegisterPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [name, setName] = createSignal("");
  const [email, setEmail] = createSignal("");
  const [code, setCode] = createSignal("");
  /** The address a code was sent to; `null` until the first send succeeds. */
  const [sentTo, setSentTo] = createSignal<string | null>(null);
  const [notice, setNotice] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [pending, setPending] = createSignal<"send" | "verify" | null>(null);
  const [cooldown, setCooldown] = createSignal(0);
  const session = authClient.useSession();
  const signedInAs = () => session().data?.user;
  const [signingOut, setSigningOut] = createSignal(false);

  let codeInput: HTMLInputElement | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;

  onCleanup(() => clearInterval(timer));

  const codeSent = () => sentTo() !== null;

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

  /**
   * Editing the address invalidates the code that was sent to the old one, so
   * the screen returns to "Continue" rather than letting a stale code fail.
   */
  const updateEmail = (value: string) => {
    setEmail(value);

    if (sentTo() === null || value.trim().toLowerCase() === sentTo()) return;

    clearInterval(timer);
    setSentTo(null);
    setCode("");
    setNotice(null);
    setError(null);
    setCooldown(0);
  };

  /**
   * A passkey registration must start from a guest session. Rather than
   * failing with a generic error, explain the state and offer the one action
   * that can fix it.
   */
  const signOutForRegistration = async () => {
    setSigningOut(true);
    await authClient.signOut();
    setSigningOut(false);
    setError(null);
  };

  const returnTo = () =>
    searchParams.returnTo && Array.isArray(searchParams.returnTo)
      ? searchParams.returnTo[0]
      : searchParams.returnTo;

  /** Keep an auth flow target (for example an invitation) across sibling links. */
  const withReturnTo = (href: string) => {
    const target = returnTo();

    if (!target) return href;

    return `${href}${href.includes("?") ? "&" : "?"}returnTo=${encodeURIComponent(target)}`;
  };

  onSettled(() => {
    document.title = "Create account · Mattrax";
  });

  const sendCode = async (options: { readonly resend?: boolean } = {}) => {
    if (pending() === "send" || (options.resend && cooldown() > 0)) return;

    const trimmedName = name().trim();
    const trimmedEmail = email().trim();

    setName(trimmedName);

    if (!trimmedName) {
      setError("Enter your name.");

      return;
    }

    if (!EMAIL_PATTERN.test(trimmedEmail)) {
      setError("Enter a valid email address.");

      return;
    }

    setError(null);
    setNotice(null);
    setPending("send");

    try {
      const result = await authClient.requestRegistrationCode({
        name: trimmedName,
        email: trimmedEmail,
      });

      if (result.error) {
        setError(result.error.message ?? "Could not send a verification code.");

        return;
      }

      setCode("");

      if (!result.data?.emailSent) {
        // The code is stored, but no mail left the building. Say that instead of
        // telling someone to wait for an email that is not coming.
        setError("We couldn't send that email just now. Try again in a moment.");

        return;
      }

      setSentTo(trimmedEmail);
      setNotice(
        options.resend
          ? "A new verification code has been sent."
          : "A verification code is on its way.",
      );
      startCooldown();

      // The field only exists now; move the caret there so the code can be typed
      // or autofilled without reaching for the mouse.
      queueMicrotask(() => codeInput?.focus());
    } catch (cause) {
      setError(errorMessage(raisedFailure(cause), "Could not send a verification code."));
    } finally {
      setPending(null);
    }
  };

  const finishRegistration = async (grant: string) => {
    const result = await authClient.register({
      name: name().trim(),
      email: email().trim(),
      grant,
    });

    if (result.error) {
      setError(
        errorMessage(
          result.error,
          "Could not create your account. That email may already be in use.",
        ),
      );

      return;
    }

    // One idempotent call so the welcome email has the same once-only trigger
    // as a token-verified sign-up. Never block sign-up on mail delivery.
    void authClient.requestEmailVerification();

    // The account and passkey exist. Usually registration also signs it in;
    // when the follow-up prompt did not take, send the person to the sign-in
    // page with the address filled in rather than failing the account.
    if (result.data?.signedIn === false) {
      const query = new URLSearchParams({ email: email().trim(), created: "1" });

      if (returnTo()) query.set("returnTo", returnTo()!);
      navigate(`/login?${query.toString()}`, { replace: true });

      return;
    }

    // The address is verified by the code, so there is no verification step
    // left.
    const destination = returnTo() ?? "/dashboard";
    navigate(destination, { replace: true });
  };

  const verifyCode = async () => {
    setError(null);
    setNotice(null);

    if (!/^\d{6}$/.test(code())) {
      setError("Enter the six-digit code from the email.");

      return;
    }

    setPending("verify");

    try {
      const result = await authClient.verifyRegistrationCode({
        email: email().trim(),
        code: code(),
      });

      if (result.error) {
        setError(result.error.message ?? "That code is invalid or has expired.");

        return;
      }

      await finishRegistration(Schema.decodeUnknownSync(Schema.String)(result.data?.grant));
    } catch (cause) {
      setError(errorMessage(raisedFailure(cause), "That code is invalid or has expired."));
    } finally {
      setPending(null);
    }
  };

  const handleSubmit = (event: SubmitEvent) => {
    event.preventDefault();

    if (pending() !== null) return;

    void (codeSent() ? verifyCode() : sendCode());
  };

  return (
    <main class="auth-page min-h-screen flex items-center justify-center bg-background text-foreground">
      <Title>Create account · Mattrax</Title>
      <div class="w-full max-w-sm px-4">
        <div class="mb-8 text-center">
          <a href="/" class="inline-flex items-center gap-2 mb-6">
            <BrandLogo class="h-4" />
          </a>
          <h1 class="text-2xl font-semibold text-stone-900">Create an account</h1>
          <p class="text-stone-500 text-sm mt-1">
            {codeSent()
              ? "Enter the code we sent to your inbox."
              : "We'll verify your email, then set up a passkey to sign in with."}
          </p>
        </div>

        <Show when={signedInAs()}>
          {(user) => (
            <div
              role="status"
              class={`mb-4 rounded-lg border border-warning/25 bg-warning/[0.07] p-3 text-[12.5px] leading-relaxed text-warning-foreground ${feedbackEnter}`}
            >
              <p class="font-medium">You're signed in as {user().email}</p>
              <p class="mt-1">
                Creating another account needs a fresh sign-in. Sign out first, or open this page in
                a private window.
              </p>
              <button
                type="button"
                class="mt-2 inline-flex min-h-8 items-center rounded-md border border-current/30 px-2.5 font-medium transition-opacity duration-[var(--duration-hover)] ease-swift hover:opacity-80 disabled:opacity-50"
                disabled={signingOut()}
                onClick={() => void signOutForRegistration()}
              >
                {signingOut() ? "Signing out…" : "Sign out"}
              </button>
            </div>
          )}
        </Show>

        <form onSubmit={handleSubmit} class="space-y-4" autocomplete="on" novalidate>
          <div class="space-y-1.5">
            <label for="name" class="text-sm font-medium text-stone-700">
              Name
            </label>
            <input
              id="name"
              name="name"
              type="text"
              required
              autofocus
              autocomplete="name"
              placeholder="Ada Lovelace"
              value={name()}
              onInput={(event) => setName(event.currentTarget.value)}
              class={fieldClass}
            />
          </div>

          <div class="space-y-1.5">
            <label for="email" class="text-sm font-medium text-stone-700">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autocomplete="username"
              autocapitalize="none"
              spellcheck={false}
              placeholder="you@example.com"
              value={email()}
              onInput={(event) => updateEmail(event.currentTarget.value)}
              class={fieldClass}
            />
          </div>

          <Show when={codeSent()}>
            <div class="space-y-1.5 motion-safe:animate-[mt-rise-in_160ms_var(--ease-swift)_both]">
              <EmailCodeField
                value={code()}
                onInput={setCode}
                invalid={error() !== null}
                describedBy={error() ? "register-error" : undefined}
                inputRef={(input) => (codeInput = input)}
              />
              <div class="flex items-center justify-end">
                <button
                  type="button"
                  onClick={() => void sendCode({ resend: true })}
                  disabled={pending() === "send" || cooldown() > 0}
                  class="text-xs font-medium text-stone-700 underline underline-offset-2 transition-colors duration-[var(--duration-hover)] ease-swift hover:text-stone-900 disabled:no-underline disabled:opacity-60"
                >
                  <span>
                    {pending() === "send"
                      ? "Sending…"
                      : cooldown() > 0
                        ? `Resend code in ${cooldown()}s`
                        : "Resend code"}
                  </span>
                  <span class="sr-only" aria-live="polite">
                    {pending() === "send" ? "Sending a new code" : ""}
                  </span>
                </button>
              </div>
            </div>
          </Show>

          <Show when={error()}>
            {(message) => (
              <p
                id="register-error"
                role="alert"
                class={`text-sm text-destructive ${feedbackEnter}`}
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

          <Button
            type="submit"
            class="h-10 w-full rounded-lg px-4 text-sm"
            pending={pending() !== null}
          >
            {codeSent()
              ? pending() === "verify"
                ? "Verifying…"
                : "Verify and create passkey"
              : pending() === "send"
                ? "Sending code…"
                : "Continue"}
          </Button>

          <p class="text-center text-xs leading-relaxed text-stone-500">
            We'll email a six-digit code, then ask your device to create a passkey with Face ID,
            Touch ID, Windows Hello or a security key. Mattrax never stores a password.
          </p>
        </form>

        <p class="mt-6 text-center text-sm text-stone-500">
          Already have an account?{" "}
          <a
            href={withReturnTo("/login")}
            class="text-stone-900 font-medium underline-offset-2 transition-colors duration-[var(--duration-hover)] ease-swift hover:underline"
          >
            Sign in
          </a>
        </p>
      </div>
    </main>
  );
}
