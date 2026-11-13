import { useNavigate, useSearchParams } from "@solidjs/router";
import {
  createEffect,
  createMemo,
  createSignal,
  Match,
  onCleanup,
  onSettled,
  Show,
  Switch,
  untrack,
} from "solid-js";
import { MfaPending } from "~/components/mfa-pending";
import { authClient } from "~/lib/auth";
import { ArrowLeft, Building2, Eye, EyeOff, KeyRound } from "~/components/ui/icons";
import { errorMessage } from "~/lib/errors";

type Step = "email" | "password";

/**
 * The organisation an email belongs to is resolved before the password screen
 * is shown, but never blocks it. A resolved answer is cached so moving between
 * the two steps and retrying does not repeat the lookup.
 */
type SsoDiscovery =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "available"; organization?: string | null }
  | { status: "unavailable"; reason?: string; retryable?: boolean };

const SSO_CACHE_TTL = 8 * 60 * 1000;
const SSO_NEGATIVE_TTL = 20 * 1000;
const ssoCache = new Map<string, { at: number; value: SsoDiscovery }>();
const ssoInflight = new Map<string, Promise<SsoDiscovery>>();

const emailKeyOf = (value: string) => value.trim().toLowerCase();
const looksLikeEmail = (value: string) => /^[^\s@]+@[^\s@]+$/.test(value.trim());

const peekSso = (key: string, force = false): SsoDiscovery | null => {
  const cached = ssoCache.get(key);

  if (!cached || force) return null;
  const ttl = cached.value.status === "available" ? SSO_CACHE_TTL : SSO_NEGATIVE_TTL;

  return Date.now() - cached.at < ttl ? cached.value : null;
};

/**
 * Read-only lookup so the password screen can show an organisation option
 * without minting a state token or touching the SSO cookie.
 */
const fetchSso = (email: string, force = false): Promise<SsoDiscovery> => {
  const key = emailKeyOf(email);
  const cached = peekSso(key, force);

  if (cached) return Promise.resolve(cached);
  const inflight = ssoInflight.get(key);

  if (inflight) return inflight;

  const request = (async (): Promise<SsoDiscovery> => {
    try {
      const response = await fetch(
        `/api/v1/sso/azure/start?email=${encodeURIComponent(key)}&discover=1`,
        { headers: { accept: "application/json" } },
      );

      const body = (await response.json().catch(() => ({}))) as {
        available?: boolean;
        error?: string;
        organization?: { name?: string } | null;
      };

      const value: SsoDiscovery = body.available
        ? {
            status: "available",
            organization: body.organization?.name ?? null,
          }
        : {
            status: "unavailable",
            reason: body.error ?? "Single sign-on is not available for that email",
            // A domain that genuinely has no SSO should not offer a retry, but
            // a gateway or upstream failure might recover.
            retryable: response.status >= 500 && response.status !== 503,
          };

      ssoCache.set(key, { at: Date.now(), value });

      return value;
    } catch {
      return {
        status: "unavailable",
        reason: "Could not reach the sign-in service",
        retryable: true,
      };
    } finally {
      ssoInflight.delete(key);
    }
  })();

  ssoInflight.set(key, request);

  return request;
};

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
  const [password, setPassword] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  const [pending, setPending] = createSignal(false);
  const [showPassword, setShowPassword] = createSignal(false);

  const [step, setStep] = createSignal<Step>(
    initialEmail && looksLikeEmail(initialEmail) ? "password" : "email",
  );

  const [mode, setMode] = createSignal<"password" | "emailCode">("password");

  const [flow, setFlow] = createSignal<{
    flowId: string;
    email: string;
    reference: { proofId: string; purpose: string; keyId: string };
  } | null>(null);

  const [code, setCode] = createSignal("");
  const [mfaPending, setMfaPending] = createSignal(false);
  const [passkeyPending, setPasskeyPending] = createSignal(false);
  const [ssoPending, setSsoPending] = createSignal(false);
  const [sso, setSso] = createSignal<SsoDiscovery>({ status: "idle" });
  const [ssoFor, setSsoFor] = createSignal("");
  let passwordInput: HTMLInputElement | undefined;
  let emailInput: HTMLInputElement | undefined;
  let codeInput: HTMLInputElement | undefined;
  let prefetchTimer: ReturnType<typeof setTimeout> | undefined;
  let discoverySequence = 0;

  const emailKey = createMemo(() => emailKeyOf(email()));

  onSettled(() => {
    document.title = "Sign in · Mattrax";

    if (step() === "password") {
      void discover(email());
      queueMicrotask(() => passwordInput?.focus());
    }
  });
  onCleanup(() => clearTimeout(prefetchTimer));

  createEffect(
    () => ({ message: error(), step: step(), mode: mode() }),
    ({ message, step, mode }) => {
      if (message && step === "password" && mode === "password")
        queueMicrotask(() => passwordInput?.focus());
    },
  );

  const returnTo = () =>
    searchParams.returnTo && Array.isArray(searchParams.returnTo)
      ? searchParams.returnTo[0]
      : searchParams.returnTo;

  /**
   * Browser-flow destinations such as an OAuth authorize URL are served by the
   * API Worker, not the Solid router, so resume them with a full navigation.
   */
  const finishSignIn = () => {
    const destination = returnTo() ?? "/dashboard";

    if (destination.startsWith("/api/")) window.location.assign(destination);
    else navigate(destination, { replace: true });
  };

  /** Resolve SSO without showing a spinner on the email step. */
  const discover = (value: string, force = false) => {
    const key = emailKeyOf(value);
    setSsoFor(key);

    if (!looksLikeEmail(key)) {
      setSso({ status: "idle" });

      return;
    }

    const sequence = ++discoverySequence;
    const cached = peekSso(key, force);

    if (cached) {
      setSso(cached);

      return;
    }

    setSso({ status: "checking" });
    void fetchSso(key, force).then((value) => {
      if (sequence === discoverySequence) setSso(value);
    });
  };

  const updateEmail = (value: string) => {
    setEmail(value);
    setError(null);
    clearTimeout(prefetchTimer);

    // Give the address a moment to settle while it is being typed, so the
    // second screen usually already knows whether the organisation uses SSO.
    if (looksLikeEmail(value)) {
      prefetchTimer = setTimeout(() => discover(value), 500);
    }
  };

  const backToEmail = () => {
    clearTimeout(prefetchTimer);
    discoverySequence++;
    setStep("email");
    setMode("password");
    setFlow(null);
    setCode("");
    setError(null);
    queueMicrotask(() => emailInput?.focus());
  };

  const continueWithEmail = (event: SubmitEvent) => {
    event.preventDefault();
    clearTimeout(prefetchTimer);
    const value = email().trim();

    if (!looksLikeEmail(value)) {
      setError("Enter a valid email address.");

      return;
    }

    setEmail(value);
    setError(null);
    setMode("password");
    setFlow(null);
    setCode("");
    setStep("password");
    queueMicrotask(() => passwordInput?.focus());
    // Never block the password screen on this lookup; the SSO option appears
    // when it resolves.
    discover(value);
  };

  const signInWithPasskey = async () => {
    setError(null);
    setPasskeyPending(true);
    const result = await authClient.passkeySignIn();
    setPasskeyPending(false);

    if (result.error) {
      setError(errorMessage(result.error, "That passkey wasn't accepted"));

      return;
    }

    if (result.data?.pending) {
      setMfaPending(true);

      return;
    }

    finishSignIn();
  };

  const requestCode = async (event?: SubmitEvent) => {
    event?.preventDefault();
    setError(null);
    setPending(true);

    const result = await authClient.emailCode.request({
      email: email(),
      returnTo: returnTo() ?? "/dashboard",
    });

    setPending(false);

    if (result.error) {
      setError(errorMessage(result.error, "Could not send a sign-in code"));

      return;
    }

    setFlow(result.data!);
    queueMicrotask(() => codeInput?.focus());
  };

  const completeCode = async (event: SubmitEvent) => {
    event.preventDefault();
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
      setError(errorMessage(result.error, "That code is not valid"));

      return;
    }

    if (result.data?.pending) {
      setMfaPending(true);

      return;
    }

    finishSignIn();
  };

  const startSso = async () => {
    setError(null);
    const value = email().trim();

    if (!looksLikeEmail(value)) {
      setError("Enter your work email to use organisation sign-in.");

      return;
    }

    setSsoPending(true);
    // Always obtain a fresh state token here. Prefetching one would be faster
    // but would let a later lookup overwrite the cookie this redirect needs.
    const query = new URLSearchParams({ email: value });
    const target = returnTo();

    if (target) query.set("returnTo", target);

    try {
      const response = await fetch(`/api/v1/sso/azure/start?${query.toString()}`, {
        headers: { accept: "application/json" },
      });

      const body = (await response.json().catch(() => ({}))) as {
        url?: string;
        error?: string;
        organization?: { name?: string } | null;
      };

      if (body.url) {
        window.location.assign(body.url);

        return;
      }

      setSso({
        status: "unavailable",
        reason: body.error ?? "Single sign-on is not available for that email",
        retryable: response.status >= 500 && response.status !== 503,
      });
      setError(errorMessage(body, "Single sign-on is not available for that email"));
    } catch {
      setError("Could not reach the sign-in service");
    } finally {
      setSsoPending(false);
    }
  };

  const handleSubmit = async (event: SubmitEvent) => {
    event.preventDefault();
    setError(null);
    setPending(true);

    const result = await authClient.signIn.email({
      email: email(),
      password: password(),
    });

    setPending(false);

    if (result.error) {
      setError(errorMessage(result.error, "Invalid email or password"));

      return;
    }

    if (result.data?.pending) {
      setMfaPending(true);

      return;
    }

    finishSignIn();
  };

  const ssoAvailable = () => {
    const value = sso();

    return ssoFor() === emailKey() && value.status === "available";
  };

  const ssoRetryable = () => {
    const value = sso();

    return ssoFor() === emailKey() && value.status === "unavailable" && Boolean(value.retryable);
  };

  const ssoLabel = () => {
    const value = sso();

    if (ssoPending()) return "Redirecting…";

    return value.status === "available" && value.organization
      ? `Continue with ${value.organization}`
      : "Continue with organisation SSO";
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
          <h1 class="text-2xl font-semibold text-stone-900">
            {step() === "email" ? "Sign in to Mattrax" : "Welcome back"}
          </h1>
          <p class="text-stone-500 text-sm mt-1">
            {step() === "email"
              ? "Enter your email to continue."
              : "Sign in to continue to your workspace."}
          </p>
        </div>

        <Show
          when={!mfaPending()}
          fallback={<MfaPending email={email()} onComplete={finishSignIn} />}
        >
          <Show
            when={step() === "email"}
            fallback={
              <div class="space-y-4">
                <button
                  type="button"
                  onClick={backToEmail}
                  class="-ml-1 inline-flex items-center gap-1 text-xs text-stone-500 transition-colors hover:text-stone-900"
                >
                  <ArrowLeft class="size-3.5" />
                  Use a different email
                </button>

                <div class="flex items-center gap-3 rounded-lg border border-stone-300 bg-white px-3 py-2">
                  <span class="flex size-8 shrink-0 items-center justify-center rounded-full bg-stone-100 text-xs font-semibold uppercase text-stone-600">
                    {email().slice(0, 1) || "?"}
                  </span>
                  <span class="min-w-0 flex-1">
                    <span class="block text-[11px] text-stone-500">Email</span>
                    <span class="block truncate text-sm font-medium text-stone-900">{email()}</span>
                  </span>
                </div>

                <Show when={ssoAvailable()}>
                  <div class="space-y-3">
                    <button
                      type="button"
                      disabled={ssoPending()}
                      onClick={() => void startSso()}
                      class="flex w-full items-center justify-center gap-2 rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-stone-800 disabled:opacity-50"
                    >
                      <Building2 class="size-4" />
                      {ssoLabel()}
                    </button>
                    <p class="text-center text-[11px] text-stone-500">
                      You'll be redirected to your organisation's sign-in.
                    </p>
                    <div class="relative py-1 text-center">
                      <span class="absolute inset-x-0 top-1/2 h-px bg-stone-300/70" />
                      <span class="relative bg-background px-2 text-[11px] uppercase tracking-wide text-stone-500">
                        or use a password
                      </span>
                    </div>
                  </div>
                </Show>

                <Show when={error()}>
                  {(message) => (
                    <p id="login-error" role="alert" class="text-sm text-destructive">
                      {message()}
                    </p>
                  )}
                </Show>

                <Switch>
                  <Match when={mode() === "password"}>
                    <form onSubmit={handleSubmit} class="space-y-4" autocomplete="on">
                      {/* Keeps the username paired with the password for
                          password managers without showing the address twice. */}
                      <input
                        type="email"
                        id="login-email"
                        name="email"
                        autocomplete="username"
                        readonly
                        tabindex={-1}
                        aria-hidden="true"
                        value={email()}
                        class="sr-only"
                      />
                      <div class="space-y-1.5">
                        <div class="flex items-center justify-between">
                          <label for="password" class="text-sm font-medium text-stone-700">
                            Password
                          </label>
                          <a
                            href={`/forgot-password?email=${encodeURIComponent(email())}`}
                            class="text-xs text-stone-500 hover:text-stone-900 transition-colors"
                          >
                            Forgot password?
                          </a>
                        </div>
                        <div class="relative">
                          <input
                            ref={passwordInput}
                            id="password"
                            name="password"
                            type={showPassword() ? "text" : "password"}
                            required
                            autocomplete="current-password"
                            placeholder="••••••••"
                            aria-invalid={error() ? "true" : undefined}
                            aria-describedby={error() ? "login-error" : undefined}
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
                          setFlow(null);
                          setCode("");
                          setError(null);
                        }}
                      >
                        Email me a sign-in code instead
                      </button>
                    </form>
                  </Match>

                  <Match when={mode() === "emailCode"}>
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
                              ref={codeInput}
                              id="code"
                              name="one-time-code"
                              autocomplete="one-time-code"
                              inputmode="numeric"
                              pattern="[0-9]*"
                              required
                              placeholder="000000"
                              aria-invalid={error() ? "true" : undefined}
                              aria-describedby={error() ? "login-error" : undefined}
                              value={code()}
                              onInput={(e) => setCode(e.currentTarget.value)}
                              class="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-center text-lg tracking-[0.4em] text-stone-900 outline-none focus:border-stone-500 focus:ring-2 focus:ring-stone-200 transition-colors"
                            />
                          </div>
                          <button
                            type="submit"
                            disabled={pending()}
                            class="w-full rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-50 transition-colors"
                          >
                            {pending() ? "Verifying…" : "Sign in"}
                          </button>
                          <button
                            type="button"
                            disabled={pending()}
                            class="w-full text-center text-xs text-stone-500 hover:text-stone-900 disabled:opacity-50"
                            onClick={() => void requestCode()}
                          >
                            {pending() ? "Sending…" : "Send a new code"}
                          </button>
                          <button
                            type="button"
                            class="w-full text-center text-xs text-stone-500 hover:text-stone-900"
                            onClick={() => {
                              setMode("password");
                              setFlow(null);
                              setCode("");
                              setError(null);
                              queueMicrotask(() => passwordInput?.focus());
                            }}
                          >
                            Use a password instead
                          </button>
                        </form>
                      }
                    >
                      <form onSubmit={requestCode} class="space-y-4">
                        <p class="text-sm text-muted-foreground">
                          We'll email a six-digit sign-in code to <strong>{email()}</strong>.
                        </p>
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
                            queueMicrotask(() => passwordInput?.focus());
                          }}
                        >
                          Use a password instead
                        </button>
                      </form>
                    </Show>
                  </Match>
                </Switch>

                <Show when={mode() === "password"}>
                  <div class="space-y-2 border-t border-stone-200 pt-4">
                    <button
                      type="button"
                      disabled={pending() || passkeyPending()}
                      class="flex w-full items-center justify-center gap-2 rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-800 hover:bg-stone-100 disabled:opacity-50 transition-colors"
                      onClick={signInWithPasskey}
                    >
                      <KeyRound class="size-4" />
                      {passkeyPending() ? "Waiting for your device…" : "Use a passkey instead"}
                    </button>
                    <Show when={ssoRetryable()}>
                      <button
                        type="button"
                        disabled={ssoPending()}
                        class="w-full text-center text-xs text-stone-500 hover:text-stone-900 disabled:opacity-50"
                        onClick={() => void startSso()}
                      >
                        {ssoPending()
                          ? "Contacting your organisation…"
                          : "Try organisation sign-in"}
                      </button>
                    </Show>
                  </div>
                </Show>
              </div>
            }
          >
            <form onSubmit={continueWithEmail} class="space-y-4">
              <div class="space-y-1.5">
                <label for="email" class="text-sm font-medium text-stone-700">
                  Email
                </label>
                <input
                  ref={emailInput}
                  id="email"
                  name="email"
                  type="email"
                  required
                  autofocus
                  autocomplete="username"
                  autocapitalize="none"
                  spellcheck={false}
                  placeholder="you@example.com"
                  aria-invalid={error() ? "true" : undefined}
                  aria-describedby={error() ? "email-step-error" : undefined}
                  value={email()}
                  onInput={(e) => updateEmail(e.currentTarget.value)}
                  class="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 outline-none focus:border-stone-500 focus:ring-2 focus:ring-stone-200 transition-colors"
                />
              </div>

              <Show when={error()}>
                {(message) => (
                  <p id="email-step-error" role="alert" class="text-sm text-destructive">
                    {message()}
                  </p>
                )}
              </Show>

              <button
                type="submit"
                class="w-full rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800 transition-colors"
              >
                Continue
              </button>
              <button
                type="button"
                disabled={passkeyPending()}
                class="flex w-full items-center justify-center gap-2 rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-800 hover:bg-stone-100 disabled:opacity-50 transition-colors"
                onClick={signInWithPasskey}
              >
                <KeyRound class="size-4" />
                {passkeyPending() ? "Waiting for your device…" : "Sign in with a passkey"}
              </button>
              <button
                type="button"
                disabled={ssoPending()}
                class="w-full text-center text-xs text-stone-500 hover:text-stone-900 disabled:opacity-50"
                onClick={() => void startSso()}
              >
                {ssoPending() ? "Contacting your organisation…" : "Continue with organisation SSO"}
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
      </div>
    </div>
  );
}
