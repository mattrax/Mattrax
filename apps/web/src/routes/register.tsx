import { useNavigate, useSearchParams } from "@solidjs/router";
import { createSignal, onSettled, Show } from "solid-js";
import { EmailCodeForm } from "~/components/email-code-form";
import { authClient } from "~/lib/auth";
import { errorMessage } from "~/lib/errors";

export default function RegisterPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [name, setName] = createSignal("");
  const [email, setEmail] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [confirm, setConfirm] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  const [pending, setPending] = createSignal(false);
  const [existingAccount, setExistingAccount] = createSignal<string | null>(null);
  const [step, setStep] = createSignal<"details" | "verify">("details");
  const [sentCode, setSentCode] = createSignal(false);
  const [verificationError, setVerificationError] = createSignal<string | null>(null);
  const [challenge, setChallenge] = createSignal<string | undefined>();
  const session = authClient.useSession();

  const returnTo = () =>
    searchParams.returnTo && Array.isArray(searchParams.returnTo)
      ? searchParams.returnTo[0]
      : searchParams.returnTo;

  onSettled(() => {
    document.title = "Create account · Mattrax";
  });

  const handleSubmit = async (e: SubmitEvent) => {
    e.preventDefault();
    setError(null);
    setExistingAccount(null);
    if (password() !== confirm()) {
      setError("Passwords do not match");
      return;
    }
    if (password().length < 15) {
      setError("Choose a password of at least 15 characters");
      return;
    }
    setPending(true);

    const result = await authClient.signUp.email({
      name: name(),
      email: email(),
      password: password(),
    });

    setPending(false);

    if (result.error) {
      setError(errorMessage(result.error, "Could not create account"));
      return;
    }

    if (result.data?.status === "existing-account") {
      setExistingAccount(result.data.email);
      return;
    }

    // Prove ownership of the address before the account can reach the
    // dashboard. The registration session exists already, but every tenant
    // endpoint refuses unverified users until this step completes.
    const verification = await authClient.requestEmailVerification();
    setSentCode(!verification.error);
    setVerificationError(
      verification.error
        ? errorMessage(verification.error, "Could not send a verification code. Try again.")
        : null,
    );
    setChallenge(verification.data?.challenge);
    setStep("verify");
  };

  return (
    <div class="auth-page dark min-h-screen flex items-center justify-center bg-background text-foreground">
      <div class="w-full max-w-sm px-4">
        <div class="mb-8 text-center">
          <a href="/" class="inline-flex items-center gap-2 mb-6">
            <img
              src="/assets/brand/mattrax-white.png"
              alt="Mattrax"
              class="h-4 w-auto"
              width="922"
              height="142"
            />
          </a>
          <Show when={step() === "details"}>
            <h1 class="text-2xl font-semibold text-stone-900">Create an account</h1>
            <p class="text-stone-500 text-sm mt-1">Get started with Mattrax</p>
          </Show>
        </div>

        <Show
          when={step() === "details"}
          fallback={
            <EmailCodeForm
              email={email()}
              sentInitially={sentCode()}
              initialChallenge={challenge()}
              initialError={verificationError()}
              onVerified={async () => {
                await session().refetch();
                navigate(returnTo() ?? "/dashboard", { replace: true });
              }}
            />
          }
        >
          <form onSubmit={handleSubmit} class="space-y-4">
            <div class="space-y-1.5">
              <label for="name" class="text-sm font-medium text-stone-700">
                Name
              </label>
              <input
                id="name"
                type="text"
                required
                autocomplete="name"
                placeholder="Your name"
                value={name()}
                onInput={(e) => setName(e.currentTarget.value)}
                class="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 outline-none focus:border-stone-500 focus:ring-2 focus:ring-stone-200 transition-colors"
              />
            </div>

            <div class="space-y-1.5">
              <label for="email" class="text-sm font-medium text-stone-700">
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                autocomplete="email"
                placeholder="you@example.com"
                value={email()}
                onInput={(e) => setEmail(e.currentTarget.value)}
                class="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 outline-none focus:border-stone-500 focus:ring-2 focus:ring-stone-200 transition-colors"
              />
            </div>

            <div class="space-y-1.5">
              <label for="password" class="text-sm font-medium text-stone-700">
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                autocomplete="new-password"
                placeholder="••••••••"
                value={password()}
                onInput={(e) => setPassword(e.currentTarget.value)}
                class="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 outline-none focus:border-stone-500 focus:ring-2 focus:ring-stone-200 transition-colors"
              />
            </div>

            <div class="space-y-1.5">
              <label for="confirm-password" class="text-sm font-medium text-stone-700">
                Confirm password
              </label>
              <input
                id="confirm-password"
                type="password"
                required
                autocomplete="new-password"
                placeholder="••••••••"
                value={confirm()}
                onInput={(e) => setConfirm(e.currentTarget.value)}
                class="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 outline-none focus:border-stone-500 focus:ring-2 focus:ring-stone-200 transition-colors"
              />
            </div>

            <p class="text-xs text-stone-400">
              Use at least 15 characters. A longer passphrase is stronger.
            </p>

            <Show when={error()}>{(msg) => <p class="text-sm text-red-600">{msg()}</p>}</Show>

            <Show when={existingAccount()}>
              {(email) => (
                <div class="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">
                  <p class="font-medium">An account already exists for {email()}.</p>
                  <p class="mt-1 text-amber-800">
                    Sign in with your existing password, or reset it if you've forgotten it.
                  </p>
                  <div class="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                    <a
                      href={`/login?email=${encodeURIComponent(email())}`}
                      class="font-medium underline underline-offset-2"
                    >
                      Sign in
                    </a>
                    <a href="/forgot-password" class="font-medium underline underline-offset-2">
                      Reset your password
                    </a>
                  </div>
                </div>
              )}
            </Show>

            <button
              type="submit"
              disabled={pending()}
              class="w-full rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-50 transition-colors"
            >
              {pending() ? "Creating account…" : "Create account"}
            </button>
          </form>
        </Show>

        <Show when={step() === "details"}>
          <p class="mt-6 text-center text-sm text-stone-500">
            Already have an account?{" "}
            <a href="/login" class="text-stone-900 font-medium hover:underline">
              Sign in
            </a>
          </p>
        </Show>
      </div>
    </div>
  );
}
