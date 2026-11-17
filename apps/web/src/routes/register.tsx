import { Title } from "@solidjs/meta";
import { BrandLogo } from "~/components/brand-logo";
import { useSearchParams } from "@solidjs/router";
import { useNavigate } from "~/lib/navigation";
import { createSignal, onSettled, Show } from "solid-js";
import { Schema } from "effect";
import { authClient } from "~/lib/auth";
import { Button } from "~/components/ui/button";
import { EmailCodeForm } from "~/components/email-code-form";
import { errorMessage, raisedFailure } from "~/lib/errors";

/** Inline alerts arrive with a short rise so the state change is legible. */
const feedbackEnter = "motion-safe:animate-[mt-rise-in_160ms_var(--ease-swift)_both]";

/**
 * Sign-up proves the email address before it creates anything: the code form
 * issues and checks a guest challenge, then the passkey ceremony creates the
 * account with a verified address. No callback page or email link is needed.
 */
export default function RegisterPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [name, setName] = createSignal("");
  const [email, setEmail] = createSignal("");
  const [step, setStep] = createSignal<"details" | "code">("details");
  const [error, setError] = createSignal<string | null>(null);
  const [pending, setPending] = createSignal(false);
  const session = authClient.useSession();
  const signedInAs = () => session().data?.user;
  const [signingOut, setSigningOut] = createSignal(false);

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

  const sendCode = async () => {
    const result = await authClient.requestRegistrationCode({
      name: name().trim(),
      email: email().trim(),
    });

    return result.error
      ? { error: result.error }
      : { challenge: result.data?.emailSent ? "sent" : undefined };
  };

  const verifyCode = async (code: string) => {
    const result = await authClient.verifyRegistrationCode({ email: email().trim(), code });

    return result.error ? { error: result.error } : { result: result.data?.grant };
  };

  const handleSubmit = async (event: SubmitEvent) => {
    event.preventDefault();
    setError(null);

    const trimmedName = name().trim();
    const trimmedEmail = email().trim();

    if (!trimmedName) {
      setError("Enter your name.");

      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setError("Enter a valid email address.");

      return;
    }

    setName(trimmedName);
    setEmail(trimmedEmail);
    setPending(true);

    try {
      const result = await authClient.requestRegistrationCode({
        name: trimmedName,
        email: trimmedEmail,
      });

      if (result.error) {
        setError(result.error.message ?? "Could not send a verification code.");

        return;
      }

      setStep("code");
    } catch (cause) {
      setError(errorMessage(raisedFailure(cause), "Could not send a verification code."));
    } finally {
      setPending(false);
    }
  };

  const finishRegistration = async (grant: string) => {
    const result = await authClient.register({
      name: name().trim(),
      email: email().trim(),
      grant,
    });

    if (result.error) {
      throw new Error(
        errorMessage(
          result.error,
          "Could not create your account. That email may already be in use.",
        ),
      );
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
            {step() === "details"
              ? "We'll verify your email, then set up a passkey to sign in with."
              : "Enter the code we sent to your inbox."}
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

        <Show
          when={step() === "details"}
          fallback={
            <div class="motion-safe:animate-[mt-rise-in_160ms_var(--ease-swift)_both]">
              <EmailCodeForm
                email={email()}
                sentInitially
                submitLabel="Verify and create passkey"
                requestCode={sendCode}
                verifyCode={verifyCode}
                onVerified={(result) =>
                  finishRegistration(Schema.decodeUnknownSync(Schema.String)(result))
                }
                onBack={() => {
                  setStep("details");
                  setError(null);
                }}
                backLabel="Change details"
              />
            </div>
          }
        >
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
                class="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/30 transition-colors"
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
                onInput={(event) => setEmail(event.currentTarget.value)}
                class="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/30 transition-colors"
              />
            </div>

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

            <Button type="submit" class="h-10 w-full rounded-lg px-4 text-sm" pending={pending()}>
              {pending() ? "Sending code…" : "Continue"}
            </Button>

            <p class="text-center text-xs leading-relaxed text-stone-500">
              We'll email a six-digit code, then ask your device to create a passkey with Face ID,
              Touch ID, Windows Hello or a security key. Mattrax never stores a password.
            </p>
          </form>
        </Show>

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
