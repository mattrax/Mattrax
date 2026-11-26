import { Title } from "@solidjs/meta";
import BrandLogo from "~/components/brand-logo";
import { useSearchParams } from "@solidjs/router";
import { useNavigate } from "~/lib/navigation";
import { createSignal, onCleanup, onSettled, Show } from "solid-js";
import { Schema } from "effect";
import { authClient } from "~/lib/auth";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import EmailCodeField from "~/components/email-code-field";
import { errorMessage, raisedFailure } from "~/lib/errors";
import { readRegistrationNonce, rememberRegistrationNonce } from "~/lib/registration-nonce";

/** Inline alerts arrive with a short rise so the state change is legible. */
const feedbackEnter = "page-enter";

/** Seconds before the address can ask for another code. */
const RESEND_COOLDOWN_SECONDS = 30;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The Email Verification API's autocomplete token. It is proposal-stage and
 * absent from the accessibility rule's value list, so it lives in a constant
 * the linter cannot mistake for a typo.
 */
const EMAIL_VERIFICATION_AUTOCOMPLETE = "email-verification-token";

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
  /**
   * The server-issued nonce for this form. The browser fills the hidden token
   * input only when this attribute is present; a token attempt rotates it.
   */
  const [verificationNonce, setVerificationNonce] = createSignal(readRegistrationNonce());
  const session = authClient.useSession();
  const signedInAs = () => session().data?.user;
  const [signingOut, setSigningOut] = createSignal(false);

  let codeInput: HTMLInputElement | undefined;
  /** Filled by the browser when it can verify the address inline. */
  let tokenInput: HTMLInputElement | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  /** The last value an input event submitted, so it cannot submit twice. */
  let submittedCode: string | null = null;

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
    submittedCode = null;

    // A token for the previous address is no longer evidence for this one.
    if (tokenInput) tokenInput.value = "";
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
      // The browser writes the Email Verification API token into the hidden
      // input. Read both halves from the live element so hydration, a browser
      // refill and a rotated nonce all use exactly what is in the DOM.
      const token = tokenInput?.value.trim();
      // The signal is the rotated source of truth; the DOM attribute is only a
      // fallback for a render that has not flushed yet.
      const nonce = verificationNonce()?.trim() ?? tokenInput?.getAttribute("nonce")?.trim();
      const result = await authClient.requestRegistrationCode({
        name: trimmedName,
        email: trimmedEmail,
        ...(token && nonce ? { token, nonce } : {}),
      });

      // Every token attempt rotates the nonce; a request without one leaves the
      // current binding alone.
      if (result.data?.nonce) {
        setVerificationNonce(result.data.nonce);
        rememberRegistrationNonce(result.data.nonce);
      }

      // A consumed token must not survive into the code step, where a browser
      // refill could submit it again with the old address.
      if (tokenInput) tokenInput.value = "";

      if (result.error) {
        setError(result.error.message ?? "Could not send a verification code.");

        return;
      }

      setCode("");
      submittedCode = null;

      // The browser proved the address inline: no email, no code. Go straight
      // to passkey creation with the grant the server just issued.
      if (result.data?.verified && result.data.grant) {
        setPending("verify");
        await finishRegistration(result.data.grant);

        return;
      }

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
    } catch (error_) {
      setError(errorMessage(raisedFailure(error_), "Could not send a verification code."));
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
      // The account and passkey are committed before the follow-up session is
      // issued, so a failure after that commit (a lost response, or a second
      // attempt after the wallet already stored the credential) can leave a
      // real account signed in. Send the person in rather than stranding them
      // on an error they cannot act on.
      if ((await authClient.session()).data) {
        navigate(returnTo() ?? "/dashboard", { replace: true });

        return;
      }

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

  const verifyCode = async (value: string) => {
    setError(null);
    setNotice(null);

    if (!/^\d{6}$/.test(value)) {
      setError("Enter the six-digit code from the email.");

      return;
    }

    setPending("verify");

    try {
      const result = await authClient.verifyRegistrationCode({
        email: email().trim(),
        code: value,
      });

      if (result.error) {
        setError(result.error.message ?? "That code is invalid or has expired.");

        return;
      }

      await finishRegistration(Schema.decodeUnknownSync(Schema.String)(result.data?.grant));
    } catch (error_) {
      setError(errorMessage(raisedFailure(error_), "That code is invalid or has expired."));
    } finally {
      setPending(null);
    }
  };

  /**
   * Six digits is a complete code, so it is sent as soon as it appears — typed,
   * pasted or filled by the OS autofill — rather than waiting for a button.
   * The guard stops a repeated input event from submitting the same code twice.
   */
  const updateCode = (value: string) => {
    setCode(value);

    if (value.length !== 6 || pending() !== null || value === submittedCode) return;

    submittedCode = value;
    void verifyCode(value);
  };

  const handleSubmit = (event: SubmitEvent) => {
    event.preventDefault();

    if (pending() !== null) return;

    void (codeSent() ? verifyCode(code()) : sendCode());
  };

  return (
    <main class="auth-page min-h-screen flex items-center justify-center bg-background text-foreground">
      <Title>Create account · Mattrax</Title>
      <div class="w-full max-w-sm px-4">
        <div class="mb-8 text-center">
          <a href="/" class="inline-flex items-center gap-2 mb-6">
            <BrandLogo class="h-4" />
          </a>
          <h1 class="text-2xl font-semibold text-foreground">Create an account</h1>
          <p class="text-subtle-foreground text-sm mt-1">
            {codeSent()
              ? "Enter the code we sent to your inbox."
              : "We'll verify your email, then set up a passkey to sign in with."}
          </p>
        </div>

        <Show when={signedInAs()}>
          {(user) => (
            <div
              role="status"
              class={`mb-4 rounded-lg border border-warning/25 bg-warning/[0.07] p-3 text-xs leading-relaxed text-warning-foreground ${feedbackEnter}`}
            >
              <p class="font-medium">You're already signed in as {user().email}</p>
              <p class="mt-1">
                Creating a separate account needs a fresh sign-in. Open your dashboard to keep using
                this account, or sign out first if you really want another one.
              </p>
              <div class="mt-2 flex flex-wrap items-center gap-2">
                <Button as="a" href="/dashboard" size="xs" variant="outline">
                  Open dashboard
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  class="min-h-8"
                  disabled={signingOut()}
                  onClick={() => void signOutForRegistration()}
                >
                  {signingOut() ? "Signing out…" : "Sign out"}
                </Button>
              </div>
            </div>
          )}
        </Show>

        <form onSubmit={handleSubmit} class="space-y-4" autocomplete="on" novalidate>
          <div class="space-y-1.5">
            <label for="name" class="text-sm font-medium text-muted-foreground">
              Name
            </label>
            <Input
              id="name"
              name="name"
              type="text"
              required
              autofocus
              autocomplete="name"
              placeholder="Ada Lovelace"
              value={name()}
              onInput={(event) => setName(event.currentTarget.value)}
              class="h-10"
            />
          </div>

          <div class="space-y-1.5">
            <label for="email" class="text-sm font-medium text-muted-foreground">
              Email
            </label>
            <Input
              id="email"
              name="email"
              type="email"
              required
              autocomplete="email"
              autocapitalize="none"
              spellcheck={false}
              placeholder="you@example.com"
              value={email()}
              onInput={(event) => updateEmail(event.currentTarget.value)}
              class="h-10"
            />
          </div>

          {/*
            Email Verification API progressive enhancement. A supporting
            browser (Chrome behind the origin trial, with Gmail as the issuer)
            writes a token into this input's value. Without support the input
            stays empty and the emailed code is the only path. The `nonce` is
            the server-issued, single-use binding the API checks against the
            sign-up cookie.
          */}
          <input
            ref={(input) => (tokenInput = input)}
            type="hidden"
            name="token"
            nonce={verificationNonce()}
            autocomplete={EMAIL_VERIFICATION_AUTOCOMPLETE}
          />

          <Show when={codeSent()}>
            <div class="space-y-1.5 page-enter">
              <EmailCodeField
                value={code()}
                onInput={updateCode}
                invalid={error() !== null}
                describedBy={error() ? "register-error" : undefined}
                inputRef={(input) => (codeInput = input)}
              />
              <div class="flex items-center justify-end">
                <Button
                  type="button"
                  variant="link"
                  size="xs"
                  onClick={() => void sendCode({ resend: true })}
                  disabled={pending() === "send" || cooldown() > 0}
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
                </Button>
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
              <p role="status" class={`text-sm text-success ${feedbackEnter}`}>
                {message()}
              </p>
            )}
          </Show>

          <Button
            type="submit"
            size="lg"
            class="w-full"
            pending={pending() !== null}
          >
            {codeSent()
              ? pending() === "verify"
                ? "Verifying…"
                : "Verify and create passkey"
              : pending() === "send"
                ? "Sending code…"
                : pending() === "verify"
                  ? "Setting up passkey…"
                  : "Continue"}
          </Button>
        </form>

        <Show
          when={!session().isPending}
          fallback={
            <p class="mt-6 text-center text-sm" aria-hidden="true">
              <span class="inline-block h-4 w-48 animate-pulse rounded bg-hover" />
            </p>
          }
        >
          <Show
            when={!signedInAs()}
            fallback={
              <p class="mt-6 text-center text-sm text-subtle-foreground">
                Already signed in.{" "}
                <a
                  href="/dashboard"
                  class="text-foreground font-medium underline-offset-2 transition-colors duration-(--duration-hover) ease-swift hover:underline"
                >
                  Open dashboard
                </a>
              </p>
            }
          >
            <p class="mt-6 text-center text-sm text-subtle-foreground">
              Already have an account?{" "}
              <a
                href={withReturnTo("/login")}
                class="text-foreground font-medium underline-offset-2 transition-colors duration-(--duration-hover) ease-swift hover:underline"
              >
                Sign in
              </a>
            </p>
          </Show>
        </Show>
      </div>
    </main>
  );
}
