import { useSearchParams } from "@solidjs/router";
import { useNavigate } from "~/lib/navigation";
import { BrandLogo } from "~/components/brand-logo";
import { Option, Schema } from "effect";
import { createSignal, onSettled, Show, untrack } from "solid-js";
import { MfaPending } from "~/components/mfa-pending";
import { authClient } from "~/lib/auth";
import { Building2, KeyRound } from "~/components/ui/icons";
import { errorMessage, raisedFailure } from "~/lib/errors";

const SsoStartResponse = Schema.Struct({
  url: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
});

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

  // A one-off seed for the field, not a reactive dependency: read it outside
  // tracking so the component does not warn about an untracked reactive read.
  const initialEmail = untrack(() => {
    const value = searchParams.email;

    return Array.isArray(value) ? value[0] : value;
  });

  const [email, setEmail] = createSignal(initialEmail ?? "");
  const [step, setStep] = createSignal<"email" | "choose">(initialEmail ? "choose" : "email");
  const [ssoUrl, setSsoUrl] = createSignal<string | null>(null);
  const [ssoAvailable, setSsoAvailable] = createSignal(false);
  const [emailError, setEmailError] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [ssoError, setSsoError] = createSignal<string | null>(null);
  const [passkeyPending, setPasskeyPending] = createSignal(false);
  const [checkingEmail, setCheckingEmail] = createSignal(false);
  const [mfaPending, setMfaPending] = createSignal(false);
  const created = untrack(() => searchParams.created === "1");

  onSettled(() => {
    document.title = "Sign in · Mattrax";
  });

  const returnTo = () =>
    searchParams.returnTo && Array.isArray(searchParams.returnTo)
      ? searchParams.returnTo[0]
      : searchParams.returnTo;

  /**
   * Browser-flow destinations such as an OAuth authorize URL are served by the
   * API Worker, not the Solid router, so resume them with a full navigation.
   */
  const finishSignIn = async () => {
    const typed = email().trim().toLowerCase();

    // Discoverable passkeys let the browser offer any credential for this
    // site. Hold the ceremony to the address that was typed so a mixed-up
    // device does not silently sign in as somebody else.
    if (typed) {
      const current = await authClient.session();
      const actual = current.data?.claims.email?.trim().toLowerCase();

      if (actual && actual !== typed) {
        await authClient.signOut().catch(() => undefined);
        setMfaPending(false);
        setError("That passkey belongs to a different account. Use the email you signed up with.");
        setStep("choose");

        return;
      }
    }

    const destination = returnTo() ?? "/dashboard";

    if (destination.startsWith("/api/")) window.location.assign(destination);
    else navigate(destination, { replace: true });
  };

  /** Ask the API whether this address has an organisation identity provider. */
  const continueWithEmail = async (event: SubmitEvent) => {
    event.preventDefault();
    setEmailError(null);
    setError(null);
    setSsoError(null);
    const value = email().trim();

    if (!looksLikeEmail(value)) {
      setEmailError("Enter the email address for your account.");

      return;
    }

    setEmail(value);
    setCheckingEmail(true);

    try {
      const query = new URLSearchParams({ email: value });
      const target = returnTo();

      if (target) query.set("returnTo", target);

      const response = await fetch(`/api/v1/sso/azure/start?${query.toString()}`, {
        headers: { accept: "application/json" },
      });

      const body = Option.getOrUndefined(
        Schema.decodeUnknownOption(SsoStartResponse)(await response.json().catch(() => ({}))),
      );

      setSsoUrl(body?.url ?? null);
      setSsoAvailable(Boolean(body?.url));
    } catch {
      // An unreachable SSO service must not block passkey sign-in.
      setSsoUrl(null);
      setSsoAvailable(false);
    } finally {
      setCheckingEmail(false);
      setStep("choose");
    }
  };

  const chooseSso = () => {
    const url = ssoUrl();

    if (url) {
      window.location.assign(url);

      return;
    }

    setSsoError(
      "Single sign-on is not available for that email. Use your passkey or contact your administrator.",
    );
  };

  const signInWithPasskey = async () => {
    setError(null);
    setSsoError(null);
    setPasskeyPending(true);
    let result = await authClient.passkeySignIn();

    // A fresh browser profile (or one that just signed out) can reject the
    // first assertions while the credential settles. Retry only that transient
    // rejection: a dismissed prompt must not open another sheet.
    for (let attempt = 0; result.error?.tag === "PasskeyRejected" && attempt < 10; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      result = await authClient.passkeySignIn();
    }

    setPasskeyPending(false);

    if (result.error) {
      setError(errorMessage(raisedFailure(result.error), "That passkey wasn't accepted"));

      return;
    }

    if (result.data?.pending) {
      setMfaPending(true);

      return;
    }

    await finishSignIn();
  };

  const changeEmail = () => {
    setStep("email");
    setError(null);
    setSsoError(null);
    setSsoAvailable(false);
    setSsoUrl(null);
  };

  return (
    <main class="auth-page min-h-screen flex items-center justify-center bg-background text-foreground">
      <div class="w-full max-w-sm px-4">
        <div class="mb-8 text-center">
          <a href="/" class="inline-flex items-center gap-2 mb-6">
            <BrandLogo class="h-4" />
          </a>
          <h1 class="text-2xl font-semibold text-stone-900">Sign in to Mattrax</h1>
          <p class="text-stone-500 text-sm mt-1">
            {step() === "email"
              ? "Enter your work email to continue with your organisation or a passkey."
              : ssoAvailable()
                ? "Continue with your organisation or use the passkey saved on this device."
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
              class="mb-4 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-[12.5px] text-stone-700"
            >
              Your account is ready. Sign in with the passkey you just created.
            </p>
          </Show>

          <Show
            when={step() === "email"}
            fallback={
              <div class="space-y-4">
                <div class="flex items-center justify-between gap-3 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2">
                  <span class="min-w-0 truncate text-[13px] text-stone-700">{email()}</span>
                  <button
                    type="button"
                    onClick={changeEmail}
                    class="shrink-0 text-[12px] font-medium text-stone-700 underline underline-offset-2 hover:text-stone-900"
                  >
                    Change
                  </button>
                </div>

                <Show when={error()}>
                  {(message) => (
                    <p id="login-error" role="alert" class="text-sm text-destructive">
                      {message()}
                    </p>
                  )}
                </Show>
                <Show when={ssoError()}>
                  {(message) => (
                    <p role="alert" class="text-sm text-destructive">
                      {message()}
                    </p>
                  )}
                </Show>

                <Show
                  when={ssoAvailable()}
                  fallback={
                    <button
                      type="button"
                      disabled={passkeyPending()}
                      class="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                      onClick={() => void signInWithPasskey()}
                    >
                      <KeyRound class="size-4" />
                      {passkeyPending() ? "Waiting for your device…" : "Sign in with a passkey"}
                    </button>
                  }
                >
                  <button
                    type="button"
                    class="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                    onClick={chooseSso}
                  >
                    <Building2 class="size-4" />
                    Continue with SSO
                  </button>

                  <div class="relative py-1 text-center">
                    <span class="absolute inset-x-0 top-1/2 h-px bg-stone-300/70" />
                    <span class="relative bg-background px-2 text-[11px] uppercase tracking-wide text-stone-500">
                      or
                    </span>
                  </div>

                  <button
                    type="button"
                    disabled={passkeyPending()}
                    class="flex w-full items-center justify-center gap-2 rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-800 transition-colors hover:bg-stone-100 disabled:opacity-50"
                    onClick={() => void signInWithPasskey()}
                  >
                    <KeyRound class="size-4" />
                    {passkeyPending() ? "Waiting for your device…" : "Use a passkey instead"}
                  </button>
                </Show>

                <Show when={!ssoAvailable()}>
                  <button
                    type="button"
                    class="flex w-full items-center justify-center gap-2 rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-800 transition-colors hover:bg-stone-100 disabled:opacity-50"
                    onClick={chooseSso}
                  >
                    <Building2 class="size-4" />
                    Sign in with your organisation
                  </button>
                </Show>
              </div>
            }
          >
            <form onSubmit={continueWithEmail} class="space-y-4" novalidate>
              <div class="space-y-1.5">
                <label for="email" class="text-sm font-medium text-stone-700">
                  Work email
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  required
                  autofocus
                  autocomplete="username"
                  autocapitalize="none"
                  spellcheck={false}
                  placeholder="you@company.com"
                  value={email()}
                  onInput={(event) => setEmail(event.currentTarget.value)}
                  class="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/30 transition-colors"
                />
              </div>
              <Show when={emailError()}>
                {(message) => (
                  <p role="alert" class="text-sm text-destructive">
                    {message()}
                  </p>
                )}
              </Show>
              <button
                type="submit"
                disabled={checkingEmail()}
                class="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                {checkingEmail() ? "Checking…" : "Continue"}
              </button>
            </form>
          </Show>
        </Show>

        <p class="mt-6 text-center text-sm text-stone-500">
          Don't have an account?{" "}
          <a href="/register" class="text-stone-900 font-medium hover:underline">
            Sign up
          </a>
        </p>

        <p class="mt-2 text-center text-[12.5px] text-stone-500">
          Lost every passkey?{" "}
          <a href="/recover" class="text-stone-900 font-medium hover:underline">
            Recover access
          </a>
        </p>
      </div>
    </main>
  );
}
