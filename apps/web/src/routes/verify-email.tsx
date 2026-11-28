import { Title } from "@solidjs/meta";
import BrandLogo from "~/components/brand-logo";
import { isServer } from "@solidjs/web";
import { useSearchParams } from "@solidjs/router";
import { useNavigate } from "~/lib/navigation";
import { Match } from "effect";
import { createSignal, onSettled, Show } from "solid-js";
import EmailCodeForm from "~/components/email-code-form";
import { authClient } from "~/lib/auth";
import { Spinner } from "@mattrax/ui";

const primaryLink =
  "inline-flex w-full items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors duration-(--duration-hover) ease-swift hover:bg-primary/90";

const outlineLink =
  "inline-flex w-full items-center justify-center rounded-lg border border-border-strong px-4 py-2 text-sm font-medium text-primary transition-colors duration-(--duration-hover) ease-swift hover:bg-shell";

/** Inline alerts arrive with a short rise so the state change is legible. */
const feedbackEnter = "page-enter";

export default function VerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const session = authClient.useSession();
  const [tokenStatus, setTokenStatus] = createSignal<"pending" | "ok" | "error" | null>(null);
  const [message, setMessage] = createSignal("Verifying your email address…");

  const token = () =>
    Array.isArray(searchParams.token) ? searchParams.token[0] : searchParams.token;

  /** Only a same-origin path is a safe link target for the success screen. */
  const returnTo = () => {
    const value = Array.isArray(searchParams.returnTo)
      ? searchParams.returnTo[0]
      : searchParams.returnTo;

    return value && value.startsWith("/") && !value.startsWith("//") && !value.includes("\\")
      ? value
      : undefined;
  };

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

      // The link may be opened without a session, and a token can belong to a
      // different account than the one signed in here. Refresh only the signed-
      // in account, and never optimistically patch its row: the session claim
      // plus the refetched /me decide whether this account is verified.
      if (session().data?.user) {
        const [{ refreshMeAfterEmailVerification }, { queryClient }] = await Promise.all([
          import("~/lib/me-refresh"),
          import("~/lib/query-client"),
        ]);

        await refreshMeAfterEmailVerification(queryClient);
      }

      setTokenStatus("ok");
      setMessage("Your email address is verified.");
    })();
  });

  return (
    <main class="auth-page min-h-screen flex items-center justify-center bg-background text-foreground">
      <Title>Verify email · Mattrax</Title>
      <div class="w-full max-w-sm px-4">
        <div class="mb-8 text-center">
          <a href="/" class="inline-flex items-center gap-2 mb-6">
            <BrandLogo class="h-4" />
          </a>
        </div>

        <Show when={token()}>
          <div class="space-y-5 text-center">
            <h1 class="text-2xl font-semibold text-foreground">
              {Match.value(tokenStatus()).pipe(
                Match.when("ok", () => "Email verified"),
                Match.when("error", () => "Verification failed"),
                Match.orElse(() => "Verifying email"),
              )}
            </h1>
            <p
              role={tokenStatus() === "error" ? "alert" : "status"}
              aria-live={tokenStatus() === "error" ? "assertive" : "polite"}
              class="text-sm text-subtle-foreground"
            >
              {message()}
            </p>
            <Show when={tokenStatus() === "ok"}>
              <a href={returnTo() ?? "/dashboard"} class={`${primaryLink} ${feedbackEnter}`}>
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
                class={`${primaryLink} ${feedbackEnter}`}
              >
                Send a new verification email
              </a>
              <a href="/login" class={`${outlineLink} ${feedbackEnter}`}>
                Back to sign in
              </a>
            </Show>
          </div>
        </Show>

        <Show when={!token()}>
          <Show
            when={!session().isPending}
            fallback={
              <p
                role="status"
                class="flex items-center justify-center gap-2 text-center text-sm text-subtle-foreground"
              >
                <span aria-hidden="true">
                  <Spinner class="size-3.5" />
                </span>
                Checking your session…
              </p>
            }
          >
            <Show
              when={session().data?.user}
              fallback={
                <div class="space-y-5 text-center">
                  <h1 class="text-2xl font-semibold text-foreground">Verify your email</h1>
                  <p class="text-sm text-subtle-foreground">
                    Sign in first, then we can send a verification code to your address.
                  </p>
                  <a
                    href={`/login?returnTo=${encodeURIComponent(returnTo() ?? "/dashboard")}`}
                    class={primaryLink}
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
                      <h1 class="text-2xl font-semibold text-foreground">Email verified</h1>
                      <p class="text-sm text-subtle-foreground">{user().email} is already verified.</p>
                      <a href={returnTo() ?? "/dashboard"} class={primaryLink}>
                        Continue to dashboard
                      </a>
                    </div>
                  }
                >
                  <EmailCodeForm
                    email={user().email}
                    onVerified={async () => {
                      await session().refetch();
                      const [{ refreshMeAfterEmailVerification }, { queryClient }] =
                        await Promise.all([
                          import("~/lib/me-refresh"),
                          import("~/lib/query-client"),
                        ]);

                      // The code proves this session's address, so it is safe to
                      // optimistically mark the row before the refetch lands.
                      await refreshMeAfterEmailVerification(queryClient, { optimistic: true });

                      // Defer past the query-cache write: navigation issued in
                      // the same tick is dropped by the router transition.
                      setTimeout(() => navigate(returnTo() ?? "/dashboard", { replace: true }), 0);
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
