import { useNavigate, useSearchParams } from "@solidjs/router";
import { createSignal, Show } from "solid-js";
import { authClient } from "~/lib/auth";

export default function RegisterPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [name, setName] = createSignal("");
  const [email, setEmail] = createSignal("");
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
    if (password().length < 12) {
      setError("Choose a password of at least 12 characters");
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
      setError(result.error.message ?? "Could not create account");
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
          <h1 class="text-2xl font-semibold text-stone-900">Create an account</h1>
          <p class="text-stone-500 text-sm mt-1">Get started with Mattrax</p>
        </div>

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
            Use at least 12 characters. A longer passphrase is stronger.
          </p>

          <Show when={error()}>{(msg) => <p class="text-sm text-red-600">{msg()}</p>}</Show>

          <button
            type="submit"
            disabled={pending()}
            class="w-full rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-50 transition-colors"
          >
            {pending() ? "Creating account…" : "Create account"}
          </button>
        </form>

        <p class="mt-6 text-center text-sm text-stone-500">
          Already have an account?{" "}
          <a href="/login" class="text-stone-900 font-medium hover:underline">
            Sign in
          </a>
        </p>
      </div>
    </div>
  );
}
