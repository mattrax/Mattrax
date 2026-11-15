import { Title } from "@solidjs/meta";
import { isServer } from "@solidjs/web";
import { useNavigate, useSearchParams } from "@solidjs/router";
import { Match } from "effect";
import { createSignal, onSettled, Show } from "solid-js";
import { EmailCodeForm } from "~/components/email-code-form";
import { authClient } from "~/lib/auth";

export default function VerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const session = authClient.useSession();
  const [tokenStatus, setTokenStatus] = createSignal<"pending" | "ok" | "error" | null>(null);
  const [message, setMessage] = createSignal("Verifying your email address…");

  const token = () =>
    Array.isArray(searchParams.token) ? searchParams.token[0] : searchParams.token;

  const returnTo = () =>
    Array.isArray(searchParams.returnTo) ? searchParams.returnTo[0] : searchParams.returnTo;

  onSettled(() => {
    document.title = "Verify email · Mattrax";

    if (!token()) return;
    setTokenStatus("pending");
    void (async () => {
      const result = await authClient.verifyEmail({ token: token()! });

      // The token is single-use. Drop it from the address bar and history so
      // it cannot leak through a copied URL, bookmark or Referer header.
      if (!isServer)
        window.history.replaceState(
          null,
          "",
          returnTo()
            ? `/verify-email?returnTo=${encodeURIComponent(returnTo()!)}`
            : "/verify-email",
        );

      if (result.error) {
        setTokenStatus("error");
        setMessage("This verification link is invalid, expired, or has already been used.");

        return;
      }

      await session().refetch();
      setTokenStatus("ok");
      setMessage("Your email address is verified.");
    })();
  });

  return (
    <main class="auth-page dark min-h-screen flex items-center justify-center bg-background text-foreground">
      <Title>Verify email · Mattrax</Title>
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
        </div>

        <Show when={token()}>
          <div class="space-y-5 text-center">
            <h1 class="text-2xl font-semibold text-stone-900">
              {Match.value(tokenStatus()).pipe(
                Match.when("ok", () => "Email verified"),
                Match.when("error", () => "Verification failed"),
                Match.orElse(() => "Verifying email"),
              )}
            </h1>
            <p
              role={tokenStatus() === "error" ? "alert" : "status"}
              aria-live={tokenStatus() === "error" ? "assertive" : "polite"}
              class="text-sm text-stone-500"
            >
              {message()}
            </p>
            <Show when={tokenStatus() === "ok"}>
              <a
                href={returnTo() ?? "/dashboard"}
                class="inline-flex w-full items-center justify-center rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800"
              >
                Continue to dashboard
              </a>
            </Show>
            <Show when={tokenStatus() === "error"}>
              <a
                href={
                  returnTo()
                    ? `/verify-email?returnTo=${encodeURIComponent(returnTo()!)}`
                    : "/verify-email"
                }
                class="inline-flex w-full items-center justify-center rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800"
              >
                Send a new verification email
              </a>
              <a
                href="/login"
                class="inline-flex w-full items-center justify-center rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-800 hover:bg-stone-100"
              >
                Back to sign in
              </a>
            </Show>
          </div>
        </Show>

        <Show when={!token()}>
          <Show
            when={!session().isPending}
            fallback={
              <p role="status" class="text-center text-sm text-stone-500">
                Checking your session…
              </p>
            }
          >
            <Show
              when={session().data?.user}
              fallback={
                <div class="space-y-5 text-center">
                  <h1 class="text-2xl font-semibold text-stone-900">Verify your email</h1>
                  <p class="text-sm text-stone-500">
                    Sign in first, then we can send a verification code to your address.
                  </p>
                  <a
                    href={`/login?returnTo=${encodeURIComponent(returnTo() ?? "/dashboard")}`}
                    class="inline-flex w-full items-center justify-center rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800"
                  >
                    Sign in
                  </a>
                </div>
              }
            >
              {(user) => (
                <Show
                  when={!user().emailVerified}
                  fallback={
                    <div class="space-y-5 text-center">
                      <h1 class="text-2xl font-semibold text-stone-900">Email verified</h1>
                      <p class="text-sm text-stone-500">{user().email} is already verified.</p>
                      <a
                        href={returnTo() ?? "/dashboard"}
                        class="inline-flex w-full items-center justify-center rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800"
                      >
                        Continue to dashboard
                      </a>
                    </div>
                  }
                >
                  <EmailCodeForm
                    email={user().email}
                    autoSend
                    onVerified={async () => {
                      await session().refetch();
                      navigate(returnTo() ?? "/dashboard", { replace: true });
                    }}
                  />
                </Show>
              )}
            </Show>
          </Show>
        </Show>
      </div>
    </main>
  );
}
