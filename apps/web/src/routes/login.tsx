import { useNavigate, useSearchParams } from "@solidjs/router";
import { Option, Schema } from "effect";
import { createSignal, onSettled, Show, untrack } from "solid-js";
import { MfaPending } from "~/components/mfa-pending";
import { authClient } from "~/lib/auth";
import { ArrowLeft, Building2, KeyRound } from "~/components/ui/icons";
import { errorMessage, raisedFailure } from "~/lib/errors";

const SsoStartResponse = Schema.Struct({
  url: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
});

const looksLikeEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

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
  const [error, setError] = createSignal<string | null>(null);
  const [ssoError, setSsoError] = createSignal<string | null>(null);
  const [passkeyPending, setPasskeyPending] = createSignal(false);
  const [ssoPending, setSsoPending] = createSignal(false);
  const [ssoForm, setSsoForm] = createSignal(false);
  const [mfaPending, setMfaPending] = createSignal(false);
  const [emailOverride, setEmailOverride] = createSignal("");

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
  const finishSignIn = () => {
    const destination = returnTo() ?? "/dashboard";

    if (destination.startsWith("/api/")) window.location.assign(destination);
    else navigate(destination, { replace: true });
  };

  const signInWithPasskey = async () => {
    setError(null);
    setPasskeyPending(true);
    const result = await authClient.passkeySignIn();
    setPasskeyPending(false);

    if (result.error) {
      setError(errorMessage(raisedFailure(result.error), "That passkey wasn't accepted"));

      return;
    }

    if (result.data?.pending) {
      setMfaPending(true);

      return;
    }

    finishSignIn();
  };

  const startSso = async (event: SubmitEvent) => {
    event.preventDefault();
    setSsoError(null);
    const value = email().trim();

    if (!looksLikeEmail(value)) {
      setSsoError("Enter your work email to use organisation sign-in.");

      return;
    }

    setSsoPending(true);
    // Obtain a fresh state token here so a later lookup cannot overwrite the
    // cookie this redirect needs.
    const query = new URLSearchParams({ email: value });
    const target = returnTo();

    if (target) query.set("returnTo", target);

    try {
      const response = await fetch(`/api/v1/sso/azure/start?${query.toString()}`, {
        headers: { accept: "application/json" },
      });

      const body = Option.getOrUndefined(
        Schema.decodeUnknownOption(SsoStartResponse)(await response.json().catch(() => ({}))),
      );

      if (body?.url) {
        window.location.assign(body.url);

        return;
      }

      setSsoError(
        errorMessage(
          raisedFailure(body),
          body?.error ?? "Single sign-on is not available for that email",
        ),
      );
    } catch {
      setSsoError("Could not reach the sign-in service");
    } finally {
      setSsoPending(false);
    }
  };

  return (
    <main class="auth-page dark min-h-screen flex items-center justify-center bg-background text-foreground">
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
          <h1 class="text-2xl font-semibold text-stone-900">Sign in to Mattrax</h1>
          <p class="text-stone-500 text-sm mt-1">
            {ssoForm()
              ? "Sign in with your organisation's identity provider."
              : "Use the passkey saved on this device or a nearby device."}
          </p>
        </div>

        <Show
          when={!mfaPending()}
          fallback={<MfaPending email={emailOverride() || email()} onComplete={finishSignIn} />}
        >
          <div class="space-y-4">
            <Show when={error()}>
              {(message) => (
                <p id="login-error" role="alert" class="text-sm text-destructive">
                  {message()}
                </p>
              )}
            </Show>

            <button
              type="button"
              disabled={passkeyPending() || ssoPending()}
              class="flex w-full items-center justify-center gap-2 rounded-lg bg-stone-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-stone-800 disabled:opacity-50"
              onClick={() => void signInWithPasskey()}
            >
              <KeyRound class="size-4" />
              {passkeyPending() ? "Waiting for your device…" : "Sign in with a passkey"}
            </button>

            <div class="relative py-1 text-center">
              <span class="absolute inset-x-0 top-1/2 h-px bg-stone-300/70" />
              <span class="relative bg-background px-2 text-[11px] uppercase tracking-wide text-stone-500">
                or
              </span>
            </div>

            <Show
              when={ssoForm()}
              fallback={
                <button
                  type="button"
                  disabled={ssoPending()}
                  class="flex w-full items-center justify-center gap-2 rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-800 transition-colors hover:bg-stone-100 disabled:opacity-50"
                  onClick={() => {
                    setError(null);
                    setSsoError(null);
                    setSsoForm(true);
                  }}
                >
                  <Building2 class="size-4" />
                  Sign in with your organisation
                </button>
              }
            >
              <form onSubmit={startSso} class="space-y-3" novalidate>
                <button
                  type="button"
                  onClick={() => {
                    setSsoForm(false);
                    setSsoError(null);
                  }}
                  class="-ml-1 inline-flex h-7 items-center gap-1 rounded-md px-2 text-[13px] text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-900"
                >
                  <ArrowLeft class="size-3.5" />
                  Back
                </button>
                <Show when={ssoError()}>
                  {(message) => (
                    <p role="alert" class="text-sm text-destructive">
                      {message()}
                    </p>
                  )}
                </Show>
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
                    onInput={(event) => {
                      setEmail(event.currentTarget.value);
                      setEmailOverride(event.currentTarget.value);
                    }}
                    class="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 outline-none focus:border-stone-500 focus:ring-2 focus:ring-stone-200 transition-colors"
                  />
                </div>
                <button
                  type="submit"
                  disabled={ssoPending()}
                  class="flex w-full items-center justify-center gap-2 rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-stone-800 disabled:opacity-50"
                >
                  <Building2 class="size-4" />
                  {ssoPending() ? "Contacting your organisation…" : "Continue with SSO"}
                </button>
                <p class="text-center text-[11px] leading-relaxed text-stone-500">
                  You'll be redirected to your organisation's sign-in. If SSO is not available, use
                  a passkey or contact your administrator.
                </p>
              </form>
            </Show>
          </div>
        </Show>

        <p class="mt-6 text-center text-sm text-stone-500">
          Don't have an account?{" "}
          <a href="/register" class="text-stone-900 font-medium hover:underline">
            Sign up
          </a>
        </p>
      </div>
    </main>
  );
}
