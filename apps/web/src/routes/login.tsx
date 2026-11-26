import { useSearchParams } from "@solidjs/router";
import { useNavigate } from "~/lib/navigation";
import BrandLogo from "~/components/brand-logo";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { createSignal, onCleanup, onSettled, Show, untrack } from "solid-js";
import MfaPending from "~/components/mfa-pending";
import { authClient } from "~/lib/auth";
import { KeyRound } from "~/components/ui/icons";
import { redirectToProvider, startOrganisationSso } from "~/lib/sso-start";
import { conditionalPasskeyAvailable, passkeySignInFailureMessage } from "~/lib/passkey-sign-in";

/** Inline alerts arrive with a short rise so the state change is legible. */
const feedbackEnter = "page-enter";

const looksLikeEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

/**
 * Email-first sign-in. The address decides which credential the account uses:
 * an organisation with SSO continues at its identity provider, everything else
 * uses the passkey saved on the device. A passkey ceremony is discoverable, so
 * the signed-in identity is checked against the address the person typed before
 * the session is used.
 */
export default function LoginPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const session = authClient.useSession();
  const signedIn = () => Boolean(session().data?.user);

  // A one-off seed for the field, not a reactive dependency: read it outside
  // tracking so the component does not warn about an untracked reactive read.
  const initialEmail = untrack(() => {
    const value = searchParams.email;

    return Array.isArray(value) ? value[0] : value;
  });

  const [email, setEmail] = createSignal(initialEmail ?? "");
  const [step, setStep] = createSignal<"email" | "choose">(initialEmail ? "choose" : "email");
  const [emailError, setEmailError] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [ssoError, setSsoError] = createSignal<string | null>(null);
  const [passkeyPending, setPasskeyPending] = createSignal(false);
  const [passkeyFailed, setPasskeyFailed] = createSignal(false);
  const [checkingEmail, setCheckingEmail] = createSignal(false);
  const [redirecting, setRedirecting] = createSignal(false);
  const [mfaPending, setMfaPending] = createSignal(false);
  const created = untrack(() => searchParams.created === "1");
  let emailLookup = 0;
  let lookupInFlight = false;
  let passkeyAttempt = 0;
  let passkeyInFlight = false;
  let redirectStarted = false;
  let conditionalAbort: AbortController | undefined;
  let conditionalRestart: ReturnType<typeof setTimeout> | undefined;

  onSettled(() => {
    document.title = "Sign in · Mattrax";

    // Registration can return here with the address prefilled. Run the same
    // SSO decision once, without starting a passkey ceremony automatically.
    if (typeof window !== "undefined" && initialEmail && looksLikeEmail(initialEmail))
      void inspectEmail();
    else void startConditionalPasskey();
  });

  const returnTo = () =>
    searchParams.returnTo && Array.isArray(searchParams.returnTo)
      ? searchParams.returnTo[0]
      : searchParams.returnTo;

  /**
   * Browser-flow destinations such as an OAuth authorize URL are served by the
   * API Worker, not the Solid router, so resume them with a full navigation.
   */
  const finishSignIn = async (isCurrent: () => boolean = () => true) => {
    if (!isCurrent()) return;

    const typed = email().trim().toLowerCase();

    // Discoverable passkeys let the browser offer any credential for this
    // site. Hold the ceremony to the address that was typed so a mixed-up
    // device does not silently sign in as somebody else.
    if (typed) {
      const current = await authClient.session();

      if (!isCurrent()) return;
      const actual = current.data?.claims.email?.trim().toLowerCase();

      if (actual && actual !== typed) {
        await authClient.signOut().catch(() => undefined);

        if (!isCurrent()) return;
        setMfaPending(false);
        setPasskeyFailed(true);
        setError("That passkey belongs to a different account. Use the email you signed up with.");
        setStep("choose");

        return;
      }
    }

    // A changed email or a newer redirect owns the screen now.
    if (!isCurrent()) return;
    const destination = returnTo() ?? "/dashboard";

    if (destination.startsWith("/api/")) window.location.assign(destination);
    else navigate(destination, { replace: true });
  };

  /** Ask the API whether this address has an organisation identity provider. */
  const inspectEmail = async () => {
    if (lookupInFlight || passkeyInFlight || redirectStarted) return;

    const value = email().trim();

    if (!looksLikeEmail(value)) {
      setEmailError("Enter the email address for your account.");

      return;
    }

    cancelConditionalPasskey();
    lookupInFlight = true;
    setEmail(value);
    setEmailError(null);
    setError(null);
    setSsoError(null);
    setCheckingEmail(true);
    const lookup = ++emailLookup;

    try {
      const result = await startOrganisationSso(value, returnTo());

      // A stale lookup must never replace a newer email step or launch a
      // second navigation after the first redirect has started.
      if (lookup !== emailLookup || redirectStarted) return;

      if (result.kind === "redirect") {
        redirectStarted = true;
        lookupInFlight = false;
        setRedirecting(true);
        setCheckingEmail(false);
        setStep("choose");

        try {
          redirectToProvider(result.url);
        } catch {
          redirectStarted = false;
          setRedirecting(false);
          setSsoError(
            "We couldn't open organisation sign-in. Check your connection and try again.",
          );
          setStep("choose");
        }

        return;
      }

      if (result.kind === "unavailable") {
        setStep("choose");

        return;
      }

      // Provider and malformed-response failures are ambiguous. Keep both a
      // manual SSO retry and the passkey path instead of blocking sign-in.
      setSsoError(result.message);
      setStep("choose");
    } catch {
      if (lookup !== emailLookup || redirectStarted) return;

      setSsoError("We couldn't start organisation sign-in. Check your connection and try again.");
      setStep("choose");
    } finally {
      if (lookup === emailLookup) {
        lookupInFlight = false;
        setCheckingEmail(false);
      }
    }
  };

  const continueWithEmail = async (event: SubmitEvent) => {
    event.preventDefault();
    await inspectEmail();
  };

  const signInWithPasskey = async () => {
    if (passkeyInFlight || lookupInFlight || redirectStarted) return;

    // The explicit prompt takes over from the inline autofill offer.
    cancelConditionalPasskey();
    const attempt = ++passkeyAttempt;
    const current = () => attempt === passkeyAttempt && !redirectStarted;

    passkeyInFlight = true;
    setError(null);
    setSsoError(null);
    setPasskeyFailed(false);
    setPasskeyPending(true);

    try {
      const result = await authClient.passkeySignIn();

      // Changing the email during a ceremony must invalidate its result before
      // any alert, MFA state or navigation can replace the newer step.
      if (!current()) {
        if (!result.error && !result.data?.pending)
          await authClient.signOut().catch(() => undefined);

        return;
      }

      if (result.error) {
        setPasskeyFailed(true);
        setError(passkeySignInFailureMessage(result.error.tag));

        return;
      }

      if (result.data?.pending) {
        setMfaPending(true);

        return;
      }

      await finishSignIn(current);
    } catch {
      if (!current()) return;

      setPasskeyFailed(true);
      setError(passkeySignInFailureMessage(undefined));
    } finally {
      if (current()) {
        passkeyInFlight = false;
        setPasskeyPending(false);
      }
    }
  };

  /** Stop the browser's inline passkey picker without surfacing an error. */
  const cancelConditionalPasskey = () => {
    if (conditionalRestart !== undefined) clearTimeout(conditionalRestart);

    conditionalRestart = undefined;
    conditionalAbort?.abort();
    conditionalAbort = undefined;
  };

  const canStartConditionalPasskey = () =>
    step() === "email" &&
    !checkingEmail() &&
    !redirecting() &&
    !passkeyPending() &&
    !mfaPending() &&
    !redirectStarted;

  /**
   * Conditional UI holds a discoverable assertion open while the email field
   * is visible, which is what lets password managers offer a saved passkey
   * inline instead of only inside the explicit button's prompt. It is an
   * enhancement: failures stay silent and the explicit button keeps the
   * recovery copy.
   */
  const startConditionalPasskey = async () => {
    if (!canStartConditionalPasskey() || conditionalAbort) return;
    if (!(await conditionalPasskeyAvailable())) return;
    if (!canStartConditionalPasskey() || conditionalAbort) return;

    const controller = new AbortController();

    conditionalAbort = controller;

    const result = await authClient.passkeySignIn({ conditional: controller.signal });

    // A changed email, unmount or newer ceremony owns the screen now. Throw
    // away a late success rather than signing in as the wrong person.
    if (controller.signal.aborted || conditionalAbort !== controller) {
      if (!result.error && !result.data?.pending) await authClient.signOut().catch(() => undefined);

      return;
    }

    conditionalAbort = undefined;

    // Dismissing the autofill sheet is not a failed sign-in.
    if (result.error) return;

    if (result.data?.pending) {
      setMfaPending(true);

      return;
    }

    await finishSignIn(() => !controller.signal.aborted);
  };

  onCleanup(() => cancelConditionalPasskey());

  /** Restart conditional UI after typing stops so the inline offer survives edits. */
  const scheduleConditionalPasskey = () => {
    cancelConditionalPasskey();

    if (!canStartConditionalPasskey()) return;

    conditionalRestart = setTimeout(() => {
      conditionalRestart = undefined;
      void startConditionalPasskey();
    }, 200);
  };

  const changeEmail = () => {
    // Invalidate any lookup or ceremony already in flight before showing the
    // email field; their late results must not write to this newer step.
    emailLookup += 1;
    passkeyAttempt += 1;
    lookupInFlight = false;
    passkeyInFlight = false;
    setStep("email");
    setEmailError(null);
    setError(null);
    setSsoError(null);
    setPasskeyFailed(false);
    setPasskeyPending(false);
    setCheckingEmail(false);
    setRedirecting(false);
    redirectStarted = false;
    scheduleConditionalPasskey();
  };

  return (
    <main class="auth-page min-h-screen flex items-center justify-center bg-background text-foreground">
      <div class="w-full max-w-sm px-4">
        <div class="mb-8 text-center">
          <a href="/" class="inline-flex items-center gap-2 mb-6">
            <BrandLogo class="h-4" />
          </a>
          <h1 id="login-heading" class="text-2xl font-semibold text-foreground">
            Sign in to Mattrax
          </h1>
          <p class="text-subtle-foreground text-sm mt-1">
            {step() === "email"
              ? "Enter your work email to continue."
              : "Use the passkey saved on this device or a nearby device."}
          </p>
        </div>

        <Show
          when={!mfaPending()}
          fallback={<MfaPending email={email()} onComplete={() => void finishSignIn()} />}
        >
          <Show when={created}>
            <p
              role="status"
              class={`mb-4 rounded-lg border border-border bg-page px-3 py-2 text-xs text-muted-foreground ${feedbackEnter}`}
            >
              Your account is ready. Sign in with the passkey you just created.
            </p>
          </Show>

          <Show
            when={step() === "email"}
            fallback={
              <div class={`space-y-4 ${feedbackEnter}`}>
                <div class="flex items-center justify-between gap-3 rounded-lg border border-border bg-page px-3 py-2">
                  {/* The address is a lookup preview: show it once the lookup
                      settles and step aside while a ceremony or redirect owns the
                      screen. Change stays usable throughout. */}
                  <Show
                    when={!checkingEmail() && !passkeyPending() && !redirecting()}
                    fallback={<span class="min-w-0 flex-1" />}
                  >
                    <span class="min-w-0 truncate text-xs text-muted-foreground">{email()}</span>
                  </Show>
                  <Button
                    type="button"
                    variant="link"
                    size="xs"
                    class="shrink-0"
                    onClick={changeEmail}
                  >
                    Change
                  </Button>
                </div>

                <Show when={redirecting()}>
                  <p role="status" class="text-center text-sm text-muted-foreground">
                    Redirecting to your organisation…
                  </p>
                  <p class="text-center text-xs text-subtle-foreground">
                    Taking too long?{" "}
                    <Button
                      type="button"
                      variant="link"
                      size="xs"
                      onClick={changeEmail}
                    >
                      Cancel and change email
                    </Button>
                  </p>
                </Show>

                <Show when={!redirecting()}>
                  <Show when={error()}>
                    {(message) => (
                      <p
                        id="login-error"
                        role="alert"
                        aria-atomic="true"
                        class={`text-sm text-destructive ${feedbackEnter}`}
                      >
                        {message()}
                      </p>
                    )}
                  </Show>
                  <Show when={ssoError()}>
                    {(message) => (
                      <p
                        id="sso-error"
                        role="alert"
                        aria-atomic="true"
                        class={`text-sm text-destructive ${feedbackEnter}`}
                      >
                        {message()}
                      </p>
                    )}
                  </Show>
                  <Show when={checkingEmail()}>
                    <p role="status" class="text-center text-xs text-subtle-foreground">
                      Checking your organisation…
                    </p>
                  </Show>

                  <Show
                    when={ssoError()}
                    fallback={
                      <Button
                        type="button"
                        size="lg"
                        class="w-full"
                        pending={passkeyPending()}
                        disabled={checkingEmail()}
                        aria-describedby={error() ? "login-error" : undefined}
                        onClick={() => void signInWithPasskey()}
                      >
                        <KeyRound class="size-4" />
                        {passkeyPending()
                          ? "Waiting for your device…"
                          : passkeyFailed()
                            ? "Try passkey again"
                            : "Sign in with a passkey"}
                      </Button>
                    }
                  >
                    <Button
                      type="button"
                      size="lg"
                      class="w-full"
                      pending={checkingEmail()}
                      disabled={passkeyPending()}
                      onClick={() => void inspectEmail()}
                    >
                      {checkingEmail() ? "Trying again…" : "Try organisation sign-in again"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="lg"
                      class="w-full"
                      pending={passkeyPending()}
                      disabled={checkingEmail()}
                      aria-describedby={error() ? "login-error" : undefined}
                      onClick={() => void signInWithPasskey()}
                    >
                      <KeyRound class="size-4" />
                      {passkeyPending()
                        ? "Waiting for your device…"
                        : passkeyFailed()
                          ? "Try passkey again"
                          : "Use a passkey instead"}
                    </Button>
                  </Show>

                  <Show when={error()}>
                    <p class="text-center text-xs text-subtle-foreground">
                      Need another way in?{" "}
                      <a
                        href="/recover"
                        class="text-foreground font-medium underline underline-offset-2 transition-colors duration-(--duration-hover) ease-swift hover:text-muted-foreground"
                      >
                        Email me a recovery link
                      </a>
                    </p>
                  </Show>
                </Show>
              </div>
            }
          >
            <form
              onSubmit={continueWithEmail}
              class="space-y-4"
              novalidate
              aria-labelledby="login-heading"
            >
              <div class="space-y-1.5">
                <label for="email" class="text-sm font-medium text-muted-foreground">
                  Work email
                </label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  required
                  autofocus
                  autocomplete="username webauthn"
                  autocapitalize="none"
                  spellcheck={false}
                  placeholder="you@company.com"
                  value={email()}
                  disabled={checkingEmail() || redirecting()}
                  aria-invalid={emailError() ? "true" : "false"}
                  aria-describedby={emailError() ? "login-email-error" : undefined}
                  onInput={(event) => {
                    setEmail(event.currentTarget.value);
                    setEmailError(null);
                    scheduleConditionalPasskey();
                  }}
                  class="h-10"
                />
              </div>
              <Show when={emailError()}>
                {(message) => (
                  <p
                    id="login-email-error"
                    role="alert"
                    aria-atomic="true"
                    class={`text-sm text-destructive ${feedbackEnter}`}
                  >
                    {message()}
                  </p>
                )}
              </Show>
              <Button
                type="submit"
                size="lg"
                class="w-full"
                pending={checkingEmail() || redirecting()}
              >
                {redirecting() ? "Redirecting…" : checkingEmail() ? "Checking…" : "Continue"}
              </Button>
            </form>
          </Show>
        </Show>

        <Show
          when={!session().isPending}
          fallback={
            <p class="mt-6 text-center text-sm" aria-hidden="true">
              <span class="inline-block h-4 w-48 animate-pulse rounded bg-hover" />
            </p>
          }
        >
          <Show
            when={!signedIn()}
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
              Don't have an account?{" "}
              <a
                href="/register"
                class="text-foreground font-medium underline-offset-2 transition-colors duration-(--duration-hover) ease-swift hover:underline"
              >
                Sign up
              </a>
            </p>
          </Show>
        </Show>

        <p class="mt-2 text-center text-xs text-subtle-foreground">
          Lost every passkey?{" "}
          <a
            href="/recover"
            class="text-foreground font-medium underline-offset-2 transition-colors duration-(--duration-hover) ease-swift hover:underline"
          >
            Recover access
          </a>
        </p>
      </div>
    </main>
  );
}
