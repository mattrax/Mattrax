import { Title } from "@solidjs/meta";
import { BrandLogo } from "~/components/brand-logo";
import { useNavigate, useSearchParams } from "@solidjs/router";
import { createSignal, onSettled, Show } from "solid-js";
import { authClient } from "~/lib/auth";
import { errorMessage } from "~/lib/errors";

export default function RegisterPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [name, setName] = createSignal("");
  const [email, setEmail] = createSignal("");
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

  const handleSubmit = async (event: SubmitEvent) => {
    event.preventDefault();
    setError(null);

    const trimmedEmail = email().trim();

    if (!name().trim()) {
      setError("Enter your name.");

      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setError("Enter a valid email address.");

      return;
    }

    setPending(true);

    const result = await authClient.register({ name: name().trim(), email: trimmedEmail });

    setPending(false);

    if (result.error) {
      setError(
        errorMessage(
          result.error,
          "Could not create your account. That email may already be in use.",
        ),
      );

      return;
    }

    setEmail(trimmedEmail);

    // The account exists and the passkey is already signed in. Prove ownership
    // of the address before the account can reach the dashboard.
    await authClient.requestEmailVerification();

    // Move to the dedicated verification page instead of switching local
    // state: registering changes the session, and a remount of this route
    // would otherwise reset the step and leave the user on a stale form.
    // `/verify-email` sends a code automatically and also accepts the link.
    navigate(
      returnTo() ? `/verify-email?returnTo=${encodeURIComponent(returnTo()!)}` : "/verify-email",
      { replace: true },
    );
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
            Use a passkey to sign in securely, without a password.
          </p>
        </div>

        <Show when={signedInAs()}>
          {(user) => (
            <div
              role="status"
              class="mb-4 rounded-lg border border-warning/25 bg-warning/[0.07] p-3 text-[12.5px] leading-relaxed text-warning-foreground"
            >
              <p class="font-medium">You're signed in as {user().email}</p>
              <p class="mt-1">
                Creating another account needs a fresh sign-in. Sign out first, or open this page in
                a private window.
              </p>
              <button
                type="button"
                class="mt-2 inline-flex min-h-8 items-center rounded-md border border-current/30 px-2.5 font-medium transition-opacity hover:opacity-80 disabled:opacity-50"
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
              <p id="register-error" role="alert" class="text-sm text-destructive">
                {message()}
              </p>
            )}
          </Show>

          <button
            type="submit"
            disabled={pending()}
            class="w-full rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {pending() ? "Waiting for your device…" : "Create account with a passkey"}
          </button>

          <p class="text-center text-xs leading-relaxed text-stone-500">
            We'll ask your device to create a passkey with Face ID, Touch ID, Windows Hello or a
            security key. Mattrax never stores a password.
          </p>
        </form>

        <p class="mt-6 text-center text-sm text-stone-500">
          Already have an account?{" "}
          <a href={withReturnTo("/login")} class="text-stone-900 font-medium hover:underline">
            Sign in
          </a>
        </p>
      </div>
    </main>
  );
}
