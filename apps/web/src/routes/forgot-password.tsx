import { useSearchParams } from "@solidjs/router";
import { createSignal, Show, untrack } from "solid-js";
import { authClient } from "~/lib/auth";
import { errorMessage } from "~/lib/errors";

export default function ForgotPasswordPage() {
  const [searchParams] = useSearchParams();
  const [email, setEmail] = createSignal(
    untrack(() => {
      const value = searchParams.email;
      return (Array.isArray(value) ? value[0] : value) ?? "";
    }),
  );
  const [error, setError] = createSignal<string | null>(null);
  const [sent, setSent] = createSignal(false);
  const [pending, setPending] = createSignal(false);

  const handleSubmit = async (e: SubmitEvent) => {
    e.preventDefault();
    setError(null);
    setPending(true);

    const result = await authClient.requestPasswordReset({
      email: email(),
      redirectTo: "/reset-password",
    });

    setPending(false);

    if (result.error) {
      setError(errorMessage(result.error, "Something went wrong"));
      return;
    }

    setSent(true);
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
          <h1 class="text-2xl font-semibold text-stone-900">Reset your password</h1>
          <p class="text-stone-500 text-sm mt-1">
            Enter your email and we'll send you a reset link
          </p>
        </div>

        <Show
          when={!sent()}
          fallback={
            <div class="rounded-lg border border-stone-200 bg-white p-5 text-center space-y-2">
              <p class="text-sm font-medium text-stone-900">Check your email</p>
              <p class="text-sm text-stone-500">
                We sent a password reset link to{" "}
                <span class="font-medium text-stone-700">{email()}</span>.
              </p>
            </div>
          }
        >
          <form onSubmit={handleSubmit} class="space-y-4">
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

            <Show when={error()}>{(msg) => <p class="text-sm text-red-600">{msg()}</p>}</Show>

            <button
              type="submit"
              disabled={pending()}
              class="w-full rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-50 transition-colors"
            >
              {pending() ? "Sending…" : "Send reset link"}
            </button>
          </form>
        </Show>

        <p class="mt-6 text-center text-sm text-stone-500">
          <a href="/login" class="text-stone-900 font-medium hover:underline">
            Back to sign in
          </a>
        </p>
      </div>
    </div>
  );
}
