import { Meta, Title } from "@solidjs/meta";
import { BrandLogo } from "~/components/brand-logo";
import { useNavigate } from "~/lib/navigation";
import { createEffect, createMemo, createSignal, onSettled, Show } from "solid-js";
import type { InvitationPreviewResponse } from "@mattrax/enterprise-domain/client";
import { ErrorText } from "~/components/mdm/common";
import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui";
import { authClient } from "~/lib/auth";
import { enterprise, enterpriseKeys } from "~/lib/enterprise";
import { errorMessage, errorTag, raisedFailure } from "~/lib/errors";
import { clearMeCache } from "~/lib/me-cache";
import { queryClient } from "~/lib/query-client";
import { rememberTenantAlias } from "~/lib/tenant";

/** Inline alerts arrive with a short rise so the state change is legible. */
const feedbackEnter = "motion-safe:animate-[mt-rise-in_160ms_var(--ease-swift)_both]";

type AcceptResult = { tenantId: string; alreadyMember: boolean };

type Stage =
  | "loading"
  | "missing"
  | "error"
  | "unknown"
  | "expired"
  | "canceled"
  | "superseded"
  | "accepted"
  | "signed-out"
  | "unverified"
  | "wrong-account"
  | "ready"
  | "submitting"
  | "joined";

/**
 * The invited address is only returned masked. A different first character or
 * domain suffix proves the signed-in account is the wrong one; a matching mask
 * can still be a different person, so the accept response remains authoritative.
 */
function maskMismatch(masked: string | undefined, current: string | undefined) {
  if (!masked || !current) return false;
  const [maskedLocal, maskedDomain] = masked.split("@");
  const [currentLocal, currentDomain] = current.split("@");

  if (!maskedLocal || !currentLocal || !maskedDomain || !currentDomain) return false;

  const suffix = maskedDomain.includes(".")
    ? maskedDomain.slice(maskedDomain.lastIndexOf(".")).toLowerCase()
    : "";

  return (
    maskedLocal[0]?.toLowerCase() !== currentLocal[0]?.toLowerCase() ||
    maskedDomain[0]?.toLowerCase() !== currentDomain[0]?.toLowerCase() ||
    (suffix !== "" && !currentDomain.toLowerCase().endsWith(suffix))
  );
}

function tenantLabel(preview: InvitationPreviewResponse | null) {
  return preview?.tenant?.displayName ?? preview?.tenant?.name ?? "this tenant";
}

export default function AcceptInvitationPage() {
  const navigate = useNavigate();
  const session = authClient.useSession();

  const [token, setToken] = createSignal<string | null>(null);
  const [synced, setSynced] = createSignal(false);
  const [preview, setPreview] = createSignal<InvitationPreviewResponse | null>(null);
  const [previewLoading, setPreviewLoading] = createSignal(true);
  const [previewError, setPreviewError] = createSignal<unknown>(null);
  const [accepting, setAccepting] = createSignal(false);
  const [acceptError, setAcceptError] = createSignal<unknown>(null);
  const [mismatch, setMismatch] = createSignal(false);
  const [joined, setJoined] = createSignal<AcceptResult | null>(null);
  const [accountVerified, setAccountVerified] = createSignal<boolean | null>(null);

  const user = () => session().data?.user;

  // Session claims are snapshotted at sign-in, so an address verified in this
  // tab can still read as unverified there. The account row is authoritative.
  createEffect(
    () => user()?.id,
    (userId) => {
      if (!userId || typeof window === "undefined") {
        setAccountVerified(null);

        return;
      }

      void enterprise
        .me()
        .then((data) => setAccountVerified(data.account.emailVerified))
        .catch(() => setAccountVerified(null));
    },
  );

  const invitePath = () =>
    token() ? `/accept-invitation?token=${encodeURIComponent(token()!)}` : "/accept-invitation";

  const returnTo = (path: string) => `${path}?returnTo=${encodeURIComponent(invitePath())}`;

  const loadPreview = async (value: string) => {
    setPreviewLoading(true);
    setPreviewError(null);

    try {
      setPreview(await enterprise.previewInvitation(value));
    } catch (error) {
      setPreviewError(error);
    } finally {
      setPreviewLoading(false);
    }
  };

  // The token is a bearer credential: read it once, then remove it from the
  // address bar so a screenshot, history entry or reload does not leak it.
  onSettled(() => {
    if (typeof window === "undefined") {
      setSynced(true);

      return;
    }

    const url = new URL(window.location.href);
    const value = url.searchParams.get("token");

    setToken(value);

    if (value) {
      url.searchParams.delete("token");
      window.history.replaceState(
        window.history.state,
        "",
        `${url.pathname}${url.search}${url.hash}`,
      );
      void loadPreview(value);
    } else {
      setPreviewLoading(false);
    }

    setSynced(true);
  });

  const unverified = () => accountVerified() === false;

  const wrongAccount = () =>
    mismatch() || maskMismatch(preview()?.invitedEmailMasked, user()?.email);

  const stage = createMemo<Stage>(() => {
    if (!synced()) return "loading";

    if (!token()) return "missing";

    if (previewLoading()) return "loading";

    if (previewError()) return "error";

    const state = preview()?.state;

    if (state === "unknown") return "unknown";

    if (state === "canceled") return "canceled";

    if (state === "superseded") return "superseded";

    if (state === "expired") return "expired";

    if (state === "accepted") return "accepted";

    if (session().isPending) return "loading";

    if (!user()) return "signed-out";

    if (unverified()) return "unverified";

    if (joined()) return "joined";

    if (wrongAccount()) return "wrong-account";

    if (accepting()) return "submitting";

    return "ready";
  });

  const heading = () => {
    const name = tenantLabel(preview());

    switch (stage()) {
      case "missing":
        return "Invitation link missing";
      case "error":
      case "unknown":
        return "Invitation unavailable";
      case "expired":
        return "Invitation expired";
      case "canceled":
        return "Invitation canceled";
      case "superseded":
        return "Invitation replaced";
      case "accepted":
        return "Invitation already accepted";
      case "wrong-account":
        return "Wrong account";
      case "unverified":
        return "Verify your email";
      case "joined":
        return `You've joined ${name}`;
      case "submitting":
        return `Joining ${name}`;
      case "signed-out":
      case "ready":
        return `Join ${name}`;
      default:
        return "Accept invitation";
    }
  };

  const accept = async () => {
    const value = token();

    if (!value || accepting()) return;
    setAccepting(true);
    setAcceptError(null);

    try {
      const result = await enterprise.acceptInvitation(value);

      setJoined(result);
      clearMeCache();

      // Land on the canonical slug. The membership list knows it now, and an
      // id URL would only be rewritten a moment later (churning the tenant
      // route's query keys for nothing).
      const me = await enterprise.me().catch(() => undefined);
      const tenant = me?.tenants.find((entry) => entry.id === result.tenantId);

      if (tenant?.slug) rememberTenantAlias(tenant.slug, result.tenantId);

      void queryClient.invalidateQueries({ queryKey: enterpriseKeys.me() });
      void queryClient.invalidateQueries({ queryKey: enterpriseKeys.tenants() });
      navigate(`/t/${tenant?.slug ?? result.tenantId}/devices`, { replace: true });
    } catch (error) {
      const tag = errorTag(raisedFailure(error));

      if (tag === "EnterpriseUnauthorized") {
        // The local session is gone (expired or revoked). Drop the cached
        // identity and fall back to the signed-out state without consuming
        // the invitation.
        await authClient.signOut();
        clearMeCache();
        await session().refetch();
        await queryClient.invalidateQueries({ queryKey: enterpriseKeys.me() });

        return;
      }

      if (tag === "EnterpriseForbidden") {
        const message = errorMessage(raisedFailure(error)).toLowerCase();

        if (message.includes("verify your email")) {
          setAccountVerified(false);
          setAcceptError(error);
        } else {
          setMismatch(true);
        }

        return;
      }

      setAcceptError(error);
    } finally {
      setAccepting(false);
    }
  };

  const switchAccount = async () => {
    await authClient.signOut();
    clearMeCache();
    await session().refetch();
    navigate(returnTo("/login"), { replace: true });
  };

  return (
    <main class="auth-page flex min-h-svh items-center justify-center bg-background px-4 py-10 text-foreground">
      <Title>Accept invitation · Mattrax</Title>
      <Meta name="referrer" content="no-referrer" />
      <div class="w-full max-w-md">
        <div class="mb-7 text-center">
          <a href="/" class="inline-flex items-center gap-2">
            <BrandLogo class="h-4" />
          </a>
        </div>

        <div class="rounded-xl border border-border bg-card p-5 shadow-2xl sm:p-6">
          <Show when={preview()?.tenant}>
            {(tenant) => (
              <div class="mb-4 flex items-center gap-3">
                <Show
                  when={tenant().logo}
                  fallback={
                    <span
                      class="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-hover text-[13px] font-semibold text-foreground"
                      aria-hidden="true"
                    >
                      {(tenant().displayName ?? tenant().name).slice(0, 1).toUpperCase()}
                    </span>
                  }
                >
                  {(logo) => (
                    <img
                      src={logo()}
                      alt=""
                      width="40"
                      height="40"
                      class="size-10 shrink-0 rounded-lg border border-border bg-surface object-contain p-1"
                    />
                  )}
                </Show>
                <div class="min-w-0">
                  <p class="truncate text-[13px] font-medium text-foreground">
                    {tenant().displayName ?? tenant().name}
                  </p>
                  <Show when={tenant().displayName && tenant().displayName !== tenant().name}>
                    <p class="truncate text-[11px] text-muted-foreground">{tenant().name}</p>
                  </Show>
                </div>
              </div>
            )}
          </Show>

          <h1 class="text-xl font-semibold tracking-[-0.02em] text-foreground">{heading()}</h1>

          <Show
            when={
              preview() &&
              preview()!.state !== "canceled" &&
              preview()!.state !== "superseded" &&
              preview()!.state !== "unknown"
            }
          >
            <dl class="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[12px]">
              <dt class="text-muted-foreground">Role</dt>
              <dd class="font-medium text-foreground">{preview()?.roleName ?? "Member"}</dd>
              <dt class="text-muted-foreground">Invited email</dt>
              <dd class="truncate font-medium text-foreground">
                {preview()?.invitedEmailMasked ?? "—"}
              </dd>
              <Show when={preview()?.expiresAt}>
                {(expiresAt) => (
                  <>
                    <dt class="text-muted-foreground">Expires</dt>
                    <dd class="text-foreground">
                      <time datetime={expiresAt()}>
                        {new Date(expiresAt()).toLocaleString(undefined, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </time>
                    </dd>
                  </>
                )}
              </Show>
            </dl>
          </Show>

          <div class="mt-4 space-y-3 text-[12.5px] leading-relaxed text-muted-foreground">
            <Show when={stage() === "loading"}>
              <p role="status" aria-live="polite" class="flex items-center gap-2">
                <span aria-hidden="true">
                  <Spinner class="size-3.5" />
                </span>
                Checking your invitation…
              </p>
            </Show>

            <Show when={stage() === "missing"}>
              <p role="alert" class={`text-destructive ${feedbackEnter}`}>
                This page needs its invitation token. Open the link from your invitation email
                again.
              </p>
            </Show>

            <Show when={stage() === "error"}>
              <ErrorText error={previewError()} />
              <Button class="min-h-11" variant="outline" onClick={() => void loadPreview(token()!)}>
                Try again
              </Button>
            </Show>

            <Show when={stage() === "unknown"}>
              <p role="alert" class={feedbackEnter}>
                This invitation link is invalid, has already been used, or was replaced. Ask the
                person who invited you to send a new invitation.
              </p>
            </Show>

            <Show when={stage() === "expired"}>
              <p role="alert" class={feedbackEnter}>
                This invitation expired before it was accepted. Ask a tenant administrator to resend
                it.
              </p>
            </Show>

            <Show when={stage() === "canceled"}>
              <p role="alert" class={feedbackEnter}>
                This invitation was canceled. Ask a tenant administrator to send a new one.
              </p>
            </Show>

            <Show when={stage() === "superseded"}>
              <p role="alert" class={feedbackEnter}>
                This invitation was replaced by a newer link. Use the most recent invitation email.
              </p>
            </Show>

            <Show when={stage() === "signed-out"}>
              <p>
                Sign in or create an account with the invited email address to accept this
                invitation.
              </p>
              <div class="flex flex-col gap-2 sm:flex-row">
                <Button as="a" href={returnTo("/login")} class="min-h-11">
                  Sign in
                </Button>
                <Button as="a" href={returnTo("/register")} variant="outline" class="min-h-11">
                  Create account
                </Button>
              </div>
            </Show>

            <Show when={stage() === "accepted"}>
              <p role="status">
                This invitation has already been accepted.
                <Show when={!user()}> Sign in to see whether you are a member.</Show>
              </p>
              <Show
                when={user()}
                fallback={
                  <Button as="a" href={returnTo("/login")} class="min-h-11">
                    Sign in
                  </Button>
                }
              >
                <Button
                  class="min-h-11"
                  onClick={() => void accept()}
                  pending={accepting()}
                  disabled={accepting()}
                >
                  {accepting() ? "Checking membership…" : "Continue to tenant"}
                </Button>
                <ErrorText error={acceptError()} />
              </Show>
            </Show>

            <Show when={stage() === "wrong-account"}>
              <p role="alert" class={feedbackEnter}>
                You're signed in as <span class="font-medium text-foreground">{user()?.email}</span>
                , but this invitation was sent to{" "}
                <span class="font-medium text-foreground">
                  {preview()?.invitedEmailMasked ?? "another address"}
                </span>
                . Switch accounts to continue.
              </p>
              <Button class="min-h-11" onClick={() => void switchAccount()}>
                Switch account
              </Button>
            </Show>

            <Show when={stage() === "unverified"}>
              <p role="alert" class={feedbackEnter}>
                Verify <span class="font-medium text-foreground">{user()?.email}</span> before
                accepting this invitation. Your invitation has not been used.
              </p>
              <Button as="a" href={returnTo("/verify-email")} class="min-h-11">
                Verify your email
              </Button>
            </Show>

            <Show
              when={
                stage() === "missing" ||
                stage() === "error" ||
                stage() === "unknown" ||
                stage() === "expired" ||
                stage() === "canceled" ||
                stage() === "superseded"
              }
            >
              <Show
                when={user()}
                fallback={
                  <div class="flex flex-col gap-2 sm:flex-row">
                    <Button as="a" href={returnTo("/login")} class="min-h-11">
                      Back to sign in
                    </Button>
                    <Button as="a" href={returnTo("/register")} variant="outline" class="min-h-11">
                      Create account
                    </Button>
                  </div>
                }
              >
                <Button as="a" href="/dashboard" class="min-h-11">
                  Go to dashboard
                </Button>
              </Show>
            </Show>

            <Show when={stage() === "ready" || stage() === "submitting" || stage() === "joined"}>
              <p>
                Signed in as <span class="font-medium text-foreground">{user()?.email}</span>.
              </p>
              <Button
                class="min-h-11 w-full sm:w-auto"
                onClick={() => void accept()}
                pending={accepting()}
                disabled={accepting() || stage() === "joined"}
              >
                {stage() === "joined"
                  ? "Joined"
                  : accepting()
                    ? `Joining ${tenantLabel(preview())}…`
                    : `Join ${tenantLabel(preview())}`}
              </Button>
              <p role="status" aria-live="polite" class="text-[11px]">
                {accepting() ? `Joining ${tenantLabel(preview())}…` : ""}
              </p>
              <Show when={acceptError()}>
                <ErrorText error={acceptError()} />
                <Show when={!accepting()}>
                  <Button class="min-h-11" variant="outline" onClick={() => void accept()}>
                    Try again
                  </Button>
                </Show>
              </Show>
            </Show>
          </div>
        </div>
      </div>
    </main>
  );
}
