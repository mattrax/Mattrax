import { useNavigate, useSearchParams } from "@solidjs/router";
import { createSignal, Show } from "solid-js";
import { authClient } from "~/lib/auth";

export default function LoginPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [email, setEmail] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  const [pending, setPending] = createSignal(false);

  const handleSubmit = async (e: SubmitEvent) => {
    e.preventDefault();
    setError(null);
    setPending(true);

    const result = await authClient.signIn.email({
      email: email(),
      password: password(),
    });

    setPending(false);

    if (result.error) {
      setError(result.error.message ?? "Invalid email or password");
      return;
    }

    const returnTo =
      searchParams.returnTo && Array.isArray(searchParams.returnTo)
        ? searchParams.returnTo[0]
        : searchParams.returnTo;
    navigate(returnTo ?? "/dashboard", { replace: true });
  };

  return (
    <div class="min-h-screen flex items-center justify-center bg-stone-50">
      <div class="w-full max-w-sm px-4">
        <div class="mb-8 text-center">
          <a href="/" class="inline-flex items-center gap-2 mb-6">
            <span class="font-semibold tracking-tight text-lg">Mattrax</span>
          </a>
          <h1 class="text-2xl font-semibold text-stone-900">Welcome back</h1>
          <p class="text-stone-500 text-sm mt-1">Sign in to your account</p>
        </div>

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

          <div class="space-y-1.5">
            <div class="flex items-center justify-between">
              <label for="password" class="text-sm font-medium text-stone-700">
                Password
              </label>
              <a
                href="/forgot-password"
                class="text-xs text-stone-500 hover:text-stone-900 transition-colors"
              >
                Forgot password?
              </a>
            </div>
            <input
              id="password"
              type="password"
              required
              autocomplete="current-password"
              placeholder="••••••••"
              value={password()}
              onInput={(e) => setPassword(e.currentTarget.value)}
              class="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 outline-none focus:border-stone-500 focus:ring-2 focus:ring-stone-200 transition-colors"
            />
          </div>

          <Show when={error()}>{(msg) => <p class="text-sm text-red-600">{msg()}</p>}</Show>

          <button
            type="submit"
            disabled={pending()}
            class="w-full rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-50 transition-colors"
          >
            {pending() ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p class="mt-6 text-center text-sm text-stone-500">
          Don't have an account?{" "}
          <a href="/register" class="text-stone-900 font-medium hover:underline">
            Sign up
          </a>
        </p>
      </div>
    </div>
  );
}
