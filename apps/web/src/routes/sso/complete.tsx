import { useNavigate, useSearchParams } from "@solidjs/router";
import { createSignal, onSettled, Show } from "solid-js";
import { MfaPending } from "~/components/mfa-pending";
import { authClient } from "~/lib/auth";

export default function SsoCompletePage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = createSignal<string | null>(null);
  const [mfaPending, setMfaPending] = createSignal(false);
  const returnTo = () => {
    const value = Array.isArray(searchParams.returnTo)
      ? searchParams.returnTo[0]
      : searchParams.returnTo;
    return value && value.startsWith("/") && !value.startsWith("//") ? value : "/dashboard";
  };

  onSettled(() => {
    const token = Array.isArray(searchParams.token) ? searchParams.token[0] : searchParams.token;
    if (!token) {
      setError("This sign-in link is missing its token.");
      return;
    }
    void (async () => {
      const result = await authClient.ssoSignIn(token);
      if (result.error) {
        setError(result.error.message ?? "Single sign-on failed.");
        return;
      }
      if (result.data?.pending) {
        setMfaPending(true);
        return;
      }
      navigate(returnTo(), { replace: true });
    })();
  });

  return (
    <div class="auth-page dark min-h-screen flex items-center justify-center bg-background text-foreground">
      <div class="w-full max-w-sm rounded-xl border bg-white p-6 text-center shadow-sm">
        <a href="/" class="mb-6 inline-flex items-center gap-2">
          <img
            src="/assets/brand/mattrax-white.png"
            alt="Mattrax"
            class="h-4 w-auto"
            width="922"
            height="142"
          />
        </a>
        <Show
          when={!mfaPending()}
          fallback={
            <div class="text-left">
              <MfaPending onComplete={() => navigate(returnTo(), { replace: true })} />
            </div>
          }
        >
          <h1 class="text-xl font-semibold text-stone-900">
            {error() ? "Sign-in failed" : "Signing you in"}
          </h1>
          <p class="mt-2 text-sm text-stone-500">{error() ?? "Finishing single sign-on…"}</p>
          <Show when={error()}>
            <a
              href="/login"
              class="mt-6 inline-flex w-full items-center justify-center rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800"
            >
              Back to sign in
            </a>
          </Show>
        </Show>
      </div>
    </div>
  );
}
