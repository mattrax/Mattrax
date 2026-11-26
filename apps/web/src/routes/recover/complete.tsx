import { Title } from "@solidjs/meta";
import { useSearchParams } from "@solidjs/router";
import { useNavigate } from "~/lib/navigation";
import { isServer } from "@solidjs/web";
import { createSignal, onSettled, Show } from "solid-js";
import { authClient } from "~/lib/auth";
import { Spinner } from "~/components/ui";
import { errorMessage, raisedFailure } from "~/lib/errors";

/**
 * Exchange the approved recovery link for a session.
 *
 * The link is minted only after the account proved control of its verified
 * address and, for a shared tenant, a different owner approved. It is single
 * use and expires after 15 minutes.
 */
export default function CompleteRecoveryPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [error, setError] = createSignal<string | null>(null);

  const token = () =>
    Array.isArray(searchParams.token) ? searchParams.token[0] : searchParams.token;

  onSettled(() => {
    document.title = "Complete recovery · Mattrax";

    if (!token()) {
      setError("This recovery link is missing its token. Request a new one.");

      return;
    }

    if (!isServer) window.history.replaceState(null, "", "/recover/complete");

    void (async () => {
      try {
        const result = await authClient.recoverySignIn(token()!);

        if (result.error) {
          setError(
            errorMessage(
              raisedFailure(result.error),
              "That recovery link is invalid, expired or has already been used.",
            ),
          );

          return;
        }

        navigate("/account", { replace: true });
      } catch (error_) {
        setError(
          errorMessage(
            raisedFailure(error_),
            "That recovery link is invalid, expired or has already been used.",
          ),
        );
      }
    })();
  });

  return (
    <main class="auth-page flex min-h-screen items-center justify-center bg-background text-foreground">
      <Title>Complete recovery · Mattrax</Title>
      <div class="w-full max-w-sm px-4 text-center">
        <h1 class="text-2xl font-semibold">Complete recovery</h1>
        <Show
          when={error()}
          fallback={
            <p
              role="status"
              class="mt-3 flex items-center justify-center gap-2 text-xs text-muted-foreground"
            >
              <span aria-hidden="true">
                <Spinner class="size-3.5" />
              </span>
              Signing you in…
            </p>
          }
        >
          {(message) => (
            <>
              <p
                role="alert"
                class="mt-3 text-xs text-destructive page-enter"
              >
                {message()}
              </p>
              <a
                href="/recover"
                class="mt-4 inline-flex text-xs font-medium text-brand underline underline-offset-2 transition-colors duration-(--duration-hover) ease-swift hover:text-brand/80"
              >
                Start recovery again
              </a>
            </>
          )}
        </Show>
      </div>
    </main>
  );
}
