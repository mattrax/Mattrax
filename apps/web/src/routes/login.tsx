import { useNavigate, useSearchParams } from "@solidjs/router";
import { createSignal, Show } from "solid-js";
import { MfaPending } from "~/components/mfa-pending";
import { authClient } from "~/lib/auth";
import { Eye, EyeOff } from "~/components/ui/icons";

export default function LoginPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [email, setEmail] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  const [pending, setPending] = createSignal(false);
  const [showPassword, setShowPassword] = createSignal(false);
  const [mode, setMode] = createSignal<"password" | "emailCode">("password");
  const [flow, setFlow] = createSignal<{
    flowId: string;
    email: string;
    reference: { proofId: string; purpose: string; keyId: string };
  } | null>(null);
  const [code, setCode] = createSignal("");
  const [ssoEmail, setSsoEmail] = createSignal("");
  const [mfaPending, setMfaPending] = createSignal(false);

  const returnTo = () =>
    searchParams.returnTo && Array.isArray(searchParams.returnTo)
      ? searchParams.returnTo[0]
      : searchParams.returnTo;

  const requestCode = async (e: SubmitEvent) => {
    e.preventDefault();
    setError(null);
    setPending(true);
    const result = await authClient.emailCode.request({
      email: email(),
      returnTo: returnTo() ?? "/dashboard",
    });
    setPending(false);
    if (result.error) {
      setError(result.error.message ?? "Could not send a sign-in code");
      return;
    }
    setFlow(result.data!);
  };

  const completeCode = async (e: SubmitEvent) => {
    e.preventDefault();
    setError(null);
    const current = flow();
    if (!current) return;
    setPending(true);
    const result = await authClient.emailCode.complete({
      ...current,
      returnTarget: returnTo() ?? "/dashboard",
      code: code(),
    });
    setPending(false);
    if (result.error) {
      setError(result.error.message ?? "That code is not valid");
      return;
    }
    if (result.data?.pending) {
      setMfaPending(true);
      return;
    }
    navigate(returnTo() ?? "/dashboard", { replace: true });
  };

  const startSso = async (e: SubmitEvent) => {
    e.preventDefault();
    setError(null);
    const response = await fetch(`/api/v1/sso/azure/start?email=${encodeURIComponent(ssoEmail())}`);
    const body = (await response.json().catch(() => ({}))) as { url?: string; error?: string };
    if (body.url) {
      window.location.href = body.url;
      return;
    }
    setError(body.error ?? "Single sign-on is not available for that email");
  };

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

    if (result.data?.pending) {
      setMfaPending(true);
      return;
    }

    navigate(returnTo() ?? "/dashboard", { replace: true });
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

        <Show
          when={!mfaPending()}
          fallback={
            <MfaPending
              email={email()}
              onComplete={() => navigate(returnTo() ?? "/dashboard", { replace: true })}
            />
          }
        >
          <Show
            when={mode() === "password"}
            fallback={
              <Show
                when={!flow()}
                fallback={
                  <form onSubmit={completeCode} class="space-y-4">
                    <p class="text-sm text-muted-foreground">
                      Enter the 6-digit code sent to <strong>{flow()!.email}</strong>.
                    </p>
                    <div class="space-y-1.5">
                      <label for="code" class="text-sm font-medium text-stone-700">
                        Sign-in code
                      </label>
                      <input
                        id="code"
                        autocomplete="one-time-code"
                        required
                        placeholder="000000"
                        value={code()}
                        onInput={(e) => setCode(e.currentTarget.value)}
                        class="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-center text-lg tracking-[0.4em] text-stone-900 outline-none focus:border-stone-500 focus:ring-2 focus:ring-stone-200 transition-colors"
                      />
                    </div>
                    <Show when={error()}>
                      {(msg) => <p class="text-sm text-red-600">{msg()}</p>}
                    </Show>
                    <button
                      type="submit"
                      disabled={pending()}
                      class="w-full rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-50 transition-colors"
                    >
                      {pending() ? "Verifying…" : "Sign in"}
                    </button>
                    <button
                      type="button"
                      class="w-full text-center text-xs text-stone-500 hover:text-stone-900"
                      onClick={() => {
                        setFlow(null);
                        setCode("");
                        setError(null);
                      }}
                    >
                      Use a different email
                    </button>
                  </form>
                }
              >
                <form onSubmit={requestCode} class="space-y-4">
                  <div class="space-y-1.5">
                    <label for="email-code" class="text-sm font-medium text-stone-700">
                      Email
                    </label>
                    <input
                      id="email-code"
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
                    {pending() ? "Sending…" : "Email me a sign-in code"}
                  </button>
                  <button
                    type="button"
                    class="w-full text-center text-xs text-stone-500 hover:text-stone-900"
                    onClick={() => {
                      setMode("password");
                      setError(null);
                    }}
                  >
                    Use a password instead
                  </button>
                </form>
              </Show>
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
                <div class="relative">
                  <input
                    id="password"
                    type={showPassword() ? "text" : "password"}
                    required
                    autocomplete="current-password"
                    placeholder="••••••••"
                    value={password()}
                    onInput={(e) => setPassword(e.currentTarget.value)}
                    class="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 pr-10 text-sm text-stone-900 placeholder:text-stone-400 outline-none focus:border-stone-500 focus:ring-2 focus:ring-stone-200 transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    class="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-stone-400 hover:text-stone-700"
                    aria-label={showPassword() ? "Hide password" : "Show password"}
                  >
                    {showPassword() ? <EyeOff class="size-4" /> : <Eye class="size-4" />}
                  </button>
                </div>
              </div>

              <Show when={error()}>{(msg) => <p class="text-sm text-red-600">{msg()}</p>}</Show>

              <button
                type="submit"
                disabled={pending()}
                class="w-full rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-50 transition-colors"
              >
                {pending() ? "Signing in…" : "Sign in"}
              </button>
              <button
                type="button"
                class="w-full text-center text-xs text-stone-500 hover:text-stone-900"
                onClick={() => {
                  setMode("emailCode");
                  setError(null);
                }}
              >
                Email me a sign-in code instead
              </button>
            </form>
          </Show>

          <form onSubmit={startSso} class="mt-5 space-y-2 border-t pt-5">
            <label for="sso-email" class="text-sm font-medium text-stone-700">
              Work email single sign-on
            </label>
            <div class="flex gap-2">
              <input
                id="sso-email"
                type="email"
                required
                autocomplete="email"
                placeholder="you@company.com"
                value={ssoEmail()}
                onInput={(e) => setSsoEmail(e.currentTarget.value)}
                class="min-w-0 flex-1 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 outline-none focus:border-stone-500 focus:ring-2 focus:ring-stone-200 transition-colors"
              />
              <button
                type="submit"
                class="rounded-lg border border-stone-300 px-3 py-2 text-sm font-medium text-stone-800 hover:bg-stone-100"
              >
                SSO
              </button>
            </div>
          </form>
        </Show>

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
