import { useNavigate, useSearchParams } from "@solidjs/router";
import { createSignal, Show } from "solid-js";
import { authClient } from "~/lib/auth";

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [password, setPassword] = createSignal("");
  const [confirm, setConfirm] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  const [pending, setPending] = createSignal(false);

  const handleSubmit = async (e: SubmitEvent) => {
    e.preventDefault();
    setError(null);

    if (password() !== confirm()) {
      setError("Passwords do not match");
      return;
    }

    const token =
      searchParams.token && Array.isArray(searchParams.token)
        ? searchParams.token[0]
        : searchParams.token;
    if (!token) {
      setError("Invalid or missing reset token. Please request a new reset link.");
      return;
    }

    setPending(true);

    const result = await authClient.resetPassword({
      newPassword: password(),
      token,
    });

    setPending(false);

    if (result.error) {
      setError(result.error.message ?? "Could not reset password");
      return;
    }

    navigate("/login", { replace: true });
  };

  return (
    <div class="min-h-screen flex items-center justify-center bg-stone-50">
      <div class="w-full max-w-sm px-4">
        <div class="mb-8 text-center">
          <a href="/" class="inline-flex items-center gap-2 mb-6">
            <span class="font-semibold tracking-tight text-lg">Mattrax</span>
          </a>
          <h1 class="text-2xl font-semibold text-stone-900">Choose a new password</h1>
          <p class="text-stone-500 text-sm mt-1">Must be at least 8 characters</p>
        </div>

        <Show
          when={searchParams.token}
          fallback={
            <div class="rounded-lg border border-red-200 bg-red-50 p-5 text-center space-y-2">
              <p class="text-sm font-medium text-red-800">Invalid reset link</p>
              <p class="text-sm text-red-600">
                This link is invalid or has expired.{" "}
                <a href="/forgot-password" class="font-medium underline">
                  Request a new one
                </a>
                .
              </p>
            </div>
          }
        >
          <form onSubmit={handleSubmit} class="space-y-4">
            <div class="space-y-1.5">
              <label for="password" class="text-sm font-medium text-stone-700">
                New password
              </label>
              <input
                id="password"
                type="password"
                required
                minLength={8}
                autocomplete="new-password"
                placeholder="••••••••"
                value={password()}
                onInput={(e) => setPassword(e.currentTarget.value)}
                class="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 outline-none focus:border-stone-500 focus:ring-2 focus:ring-stone-200 transition-colors"
              />
            </div>

            <div class="space-y-1.5">
              <label for="confirm" class="text-sm font-medium text-stone-700">
                Confirm password
              </label>
              <input
                id="confirm"
                type="password"
                required
                autocomplete="new-password"
                placeholder="••••••••"
                value={confirm()}
                onInput={(e) => setConfirm(e.currentTarget.value)}
                class="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 outline-none focus:border-stone-500 focus:ring-2 focus:ring-stone-200 transition-colors"
              />
            </div>

            <Show when={error()}>{(msg) => <p class="text-sm text-red-600">{msg()}</p>}</Show>

            <button
              type="submit"
              disabled={pending()}
              class="w-full rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-50 transition-colors"
            >
              {pending() ? "Resetting…" : "Reset password"}
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
