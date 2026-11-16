import { Title } from "@solidjs/meta";
import { BrandLogo } from "~/components/brand-logo";
import { useSearchParams } from "@solidjs/router";
import { useNavigate } from "~/lib/navigation";
import { isServer } from "@solidjs/web";
import { createSignal, onSettled, Show } from "solid-js";
import { enterprise } from "~/lib/enterprise";
import { authClient } from "~/lib/auth";
import { errorMessage, raisedFailure } from "~/lib/errors";

const inputClass =
  "h-9 w-full min-w-0 rounded-lg border border-input bg-surface px-2.5 text-base text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:text-[13px]";

/**
 * Self-service break-glass entry point.
 *
 * Two modes share the page: arriving without a token asks for the account's
 * verified address, and arriving with the emailed proof token consumes it. The
 * proof is single use, so the token is stripped from the address bar before
 * anything else happens.
 */
type RecoveryStatus = "verifying" | "pending_approval" | "signing_in" | "error";

export default function RecoverPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [email, setEmail] = createSignal("");
  const [pending, setPending] = createSignal(false);
  const [requested, setRequested] = createSignal(false);
  const [requestError, setRequestError] = createSignal<string | null>(null);
  const [status, setStatus] = createSignal<RecoveryStatus | null>(null);

  const token = () =>
    Array.isArray(searchParams.token) ? searchParams.token[0] : searchParams.token;

  onSettled(() => {
    document.title = "Recover access · Mattrax";

    if (!token()) return;
    setStatus("verifying");

    void (async () => {
      // Never let a single-use token sit in history, a bookmark or a Referer.
      if (!isServer) window.history.replaceState(null, "", "/recover");

      try {
        const result = await enterprise.verifyAccountRecovery(token()!);

        if (result.status === "pending_approval") {
          setStatus("pending_approval");

          return;
        }

        if (!result.signInToken) {
          setStatus("error");

          return;
        }

        setStatus("signing_in");
        const completion = await authClient.recoverySignIn(result.signInToken);

        if (completion.error) {
          setStatus("error");

          return;
        }

        navigate("/account", { replace: true });
      } catch (error) {
        setStatus("error");
        setRequestError(
          errorMessage(
            raisedFailure(error),
            "That recovery link is invalid, expired or has already been used.",
          ),
        );
      }
    })();
  });

  const submit = async (event: SubmitEvent) => {
    event.preventDefault();
    setRequestError(null);
    setPending(true);

    try {
      await enterprise.requestAccountRecovery(email().trim());
      setRequested(true);
    } catch (error) {
      setRequestError(
        errorMessage(raisedFailure(error), "Could not start recovery. Try again in a while."),
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <main class="auth-page flex min-h-screen items-center justify-center bg-background text-foreground">
      <Title>Recover access · Mattrax</Title>
      <div class="w-full max-w-sm px-4">
        <div class="mb-8 text-center">
          <a href="/" class="mb-6 inline-flex items-center gap-2">
            <BrandLogo class="h-4" />
          </a>
        </div>

        <Show when={token()}>
          <div class="space-y-4 text-center">
            <h1 class="text-2xl font-semibold">Recover access</h1>
            <Show when={status() === "verifying" || status() === "signing_in"}>
              <p role="status" class="text-[13px] text-muted-foreground">
                {status() === "signing_in" ? "Signing you in…" : "Checking your recovery link…"}
              </p>
            </Show>
            <Show when={status() === "pending_approval"}>
              <div class="rounded-lg border border-border bg-surface px-3 py-3 text-left text-[13px] leading-relaxed text-muted-foreground">
                <p class="font-medium text-foreground">Another owner must approve this.</p>
                <p class="mt-1">
                  Your account belongs to a tenant with more than one owner. The other owners have
                  been emailed an approval link. Once one of them approves, you will receive a
                  sign-in link at your verified address.
                </p>
              </div>
            </Show>
            <Show when={status() === "error"}>
              <p role="alert" class="text-[13px] text-destructive">
                {requestError() ?? "That recovery link is invalid or has expired."}
              </p>
              <a
                href="/recover"
                class="inline-flex text-[13px] font-medium text-brand underline underline-offset-2"
              >
                Start again
              </a>
            </Show>
          </div>
        </Show>

        <Show when={!token()}>
          <div class="space-y-5">
            <div class="space-y-1.5 text-center">
              <h1 class="text-2xl font-semibold">Recover access</h1>
              <p class="text-[13px] leading-relaxed text-muted-foreground">
                Lost every passkey? Enter the verified email address on the account. Mattrax will
                email a single-use link that proves you control it.
              </p>
            </div>

            <Show
              when={!requested()}
              fallback={
                <div class="rounded-lg border border-success/25 bg-success/[0.08] px-3 py-3 text-[13px] leading-relaxed text-success-foreground">
                  If an account with that address exists and its email is verified, a recovery link
                  is on its way. It works once and expires in 30 minutes.
                </div>
              }
            >
              <form onSubmit={submit} class="space-y-3">
                <label class="block space-y-1.5">
                  <span class="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
                    Verified email address
                  </span>
                  <input
                    type="email"
                    required
                    autocomplete="email"
                    class={inputClass}
                    placeholder="you@example.com"
                    value={email()}
                    onInput={(event) => setEmail(event.currentTarget.value)}
                  />
                </label>
                <button
                  type="submit"
                  disabled={pending() || !email().trim()}
                  class="inline-flex h-9 w-full items-center justify-center rounded-lg bg-brand-solid px-3 text-[13px] font-medium text-brand-foreground transition-opacity disabled:opacity-60"
                >
                  {pending() ? "Sending…" : "Send recovery link"}
                </button>
              </form>
            </Show>

            <Show when={requestError()}>
              {(message) => (
                <p role="alert" class="text-[13px] text-destructive">
                  {message()}
                </p>
              )}
            </Show>

            <p class="text-center text-[12.5px] text-muted-foreground">
              Remembered a device?{" "}
              <a href="/login" class="font-medium text-foreground underline underline-offset-2">
                Sign in
              </a>
            </p>
          </div>
        </Show>
      </div>
    </main>
  );
}
