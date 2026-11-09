import { useNavigate, useSearchParams } from "@solidjs/router";
import { createEffect, createSignal, Show } from "solid-js";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { authClient } from "~/lib/auth";

export default function AcceptInvitationPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const session = authClient.useSession();
  const token = () => (Array.isArray(params.token) ? params.token[0] : params.token);
  const [error, setError] = createSignal<string | null>(null);
  const [pending, setPending] = createSignal(false);
  const [started, setStarted] = createSignal(false);

  const accept = async () => {
    const value = token();
    if (!value) {
      setError("This invitation link is missing its token.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/v1/invitations/accept", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", "x-effect-auth-csrf": "1" },
        body: JSON.stringify({ token: value }),
      });
      const body = (await response.json().catch(() => undefined)) as
        | { tenantId?: string; message?: string; error?: { message?: string } }
        | undefined;
      if (!response.ok || !body?.tenantId) {
        throw new Error(
          body?.message ?? body?.error?.message ?? `Request failed (${response.status})`,
        );
      }
      navigate(`/t/${body.tenantId}/devices`, { replace: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not accept the invitation");
    } finally {
      setPending(false);
    }
  };

  createEffect(
    () => ({ pending: session().isPending, user: session().data?.user, token: token() }),
    ({ pending, user, token: value }) => {
      if (pending || !user || !value || started()) return;
      setStarted(true);
      void accept();
    },
  );

  return (
    <main class="flex min-h-svh items-center justify-center bg-stone-50 px-4">
      <Card class="w-full max-w-md bg-white">
        <CardHeader>
          <CardTitle>Accept invitation</CardTitle>
        </CardHeader>
        <CardContent class="space-y-4 text-sm">
          <Show when={!token()}>
            <p class="text-red-600">This invitation link is missing its token.</p>
          </Show>
          <Show when={!session().isPending && !session().data?.user}>
            <p class="text-muted-foreground">
              Sign in or create an account with the email address that was invited, then open this
              link again.
            </p>
            <div class="flex gap-2">
              <Button
                as="a"
                href={`/login?returnTo=${encodeURIComponent(`/accept-invitation?token=${token() ?? ""}`)}`}
              >
                Sign in
              </Button>
              <Button
                as="a"
                variant="outline"
                href={`/register?returnTo=${encodeURIComponent(`/accept-invitation?token=${token() ?? ""}`)}`}
              >
                Create account
              </Button>
            </div>
          </Show>
          <Show when={session().data?.user}>
            <p class="text-muted-foreground">
              Signed in as <strong>{session().data?.user?.email}</strong>. Joining the tenant…
            </p>
            <Show when={error()}>
              <p class="rounded-lg border border-red-200 bg-red-50 p-3 text-red-700">{error()}</p>
            </Show>
            <Show when={error()}>
              <Button onClick={accept} disabled={pending()}>
                {pending() ? "Trying…" : "Try again"}
              </Button>
            </Show>
          </Show>
        </CardContent>
      </Card>
    </main>
  );
}
