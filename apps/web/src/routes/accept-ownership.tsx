import { Meta, Title } from "@solidjs/meta";
import { BrandLogo } from "~/components/brand-logo";
import { useNavigate } from "~/lib/navigation";
import { createEffect, createMemo, createSignal, onSettled, Show } from "solid-js";
import type { OwnershipTransferPreviewResponse } from "@mattrax/enterprise-domain/client";
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

type Stage =
  | "loading"
  | "missing"
  | "error"
  | "unknown"
  | "expired"
  | "accepted"
  | "cancelled"
  | "stale"
  | "signed-out"
  | "unverified"
  | "wrong-account"
  | "ready"
  | "submitting"
  | "accepted-now";

/**
 * The target address is only returned masked. A different first character or
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

function tenantLabel(preview: OwnershipTransferPreviewResponse | null) {
  return preview?.tenant?.displayName ?? preview?.tenant?.name ?? "this tenant";
}

export default function AcceptOwnershipPage() {
  const navigate = useNavigate();
  const session = authClient.useSession();

  const [token, setToken] = createSignal<string | null>(null);
  const [synced, setSynced] = createSignal(false);
  const [preview, setPreview] = createSignal<OwnershipTransferPreviewResponse | null>(null);
  const [previewLoading, setPreviewLoading] = createSignal(true);
  const [previewError, setPreviewError] = createSignal<unknown>(null);
  const [accepting, setAccepting] = createSignal(false);
  const [acceptError, setAcceptError] = createSignal<unknown>(null);
  const [tenantId, setTenantId] = createSignal<string | null>(null);
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

  const acceptPath = () =>
    token() ? `/accept-ownership?token=${encodeURIComponent(token()!)}` : "/accept-ownership";

  const returnTo = (path: string) => `${path}?returnTo=${encodeURIComponent(acceptPath())}`;

  const loadPreview = async (value: string) => {
    setPreviewLoading(true);
    setPreviewError(null);

    try {
      setPreview(await enterprise.previewOwnershipTransfer(value));
    } catch (cause) {
      setPreviewError(cause);
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

  const wrongAccount = () => maskMismatch(preview()?.targetEmailMasked, user()?.email);

  const stage = createMemo<Stage>(() => {
    if (!synced()) return "loading";

    if (!token()) return "missing";

    if (previewLoading()) return "loading";

    if (previewError()) return "error";

    const state = preview()?.state;

    if (state === "unknown") return "unknown";

    if (state === "cancelled") return "cancelled";

    if (state === "stale") return "stale";

    if (state === "expired") return "expired";

    if (state === "accepted") return "accepted";

    if (tenantId()) return "accepted-now";

    if (session().isPending) return "loading";

    if (!user()) return "signed-out";

    if (unverified()) return "unverified";

    if (wrongAccount()) return "wrong-account";

    if (accepting()) return "submitting";

    return "ready";
  });

  const heading = () => {
    const name = tenantLabel(preview());

    switch (stage()) {
      case "missing":
        return "Transfer link missing";
      case "error":
      case "unknown":
        return "Transfer unavailable";
      case "expired":
        return "Transfer expired";
      case "cancelled":
        return "Transfer cancelled";
      case "stale":
        return "Transfer no longer valid";
      case "accepted":
        return "Transfer already accepted";
      case "wrong-account":
        return "Wrong account";
      case "unverified":
        return "Verify your email";
      case "accepted-now":
        return `You own ${name}`;
      case "submitting":
        return `Taking over ${name}`;
      case "signed-out":
      case "ready":
        return `Take over ${name}`;
      default:
        return "Accept ownership";
    }
  };

  const accept = async () => {
    const value = token();

    if (!value || accepting()) return;
    setAccepting(true);
    setAcceptError(null);

    try {
      const result = await enterprise.acceptOwnershipTransfer(value);

      setTenantId(result.tenantId);
      clearMeCache();

      const me = await enterprise.me().catch(() => undefined);
      const tenant = me?.tenants.find((entry) => entry.id === result.tenantId);

      if (tenant?.slug) rememberTenantAlias(tenant.slug, result.tenantId);

      void queryClient.invalidateQueries({ queryKey: enterpriseKeys.me() });
      void queryClient.invalidateQueries({ queryKey: enterpriseKeys.tenants() });
      void queryClient.invalidateQueries({
        queryKey: enterpriseKeys.ownershipTransfer(result.tenantId),
      });
      void queryClient.invalidateQueries({ queryKey: enterpriseKeys.accounts(result.tenantId) });
      navigate(`/t/${tenant?.slug ?? result.tenantId}/settings/administrators`, { replace: true });
    } catch (cause) {
      const tag = errorTag(raisedFailure(cause));

      if (tag === "EnterpriseUnauthorized") {
        await authClient.signOut();
        clearMeCache();
        await session().refetch();
        await queryClient.invalidateQueries({ queryKey: enterpriseKeys.me() });

        return;
      }

      if (tag === "EnterpriseForbidden") {
        const message = errorMessage(raisedFailure(cause)).toLowerCase();

        if (message.includes("verify your email")) setAccountVerified(false);
      }

      setAcceptError(cause);
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
      <Title>Accept ownership · Mattrax</Title>
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
            when={preview() && preview()!.state !== "cancelled" && preview()!.state !== "unknown"}
          >
            <dl class="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[12px]">
              <Show when={preview()?.requestedByName}>
                {(requester) => (
                  <>
                    <dt class="text-muted-foreground">Requested by</dt>
                    <dd class="truncate font-medium text-foreground">{requester()}</dd>
                  </>
                )}
              </Show>
              <dt class="text-muted-foreground">Your email</dt>
              <dd class="truncate font-medium text-foreground">
                {preview()?.targetEmailMasked ?? "—"}
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
                Checking this transfer…
              </p>
            </Show>

            <Show when={stage() === "missing"}>
              <p role="alert" class={`text-destructive ${feedbackEnter}`}>
                This page needs its transfer token. Open the link from the ownership transfer email
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
                This transfer link is invalid, has already been used, or was replaced. Ask a tenant
                owner to start a new transfer.
              </p>
            </Show>

            <Show when={stage() === "expired"}>
              <p role="alert" class={feedbackEnter}>
                This transfer expired before it was accepted. Ask a tenant owner to start a new
                transfer.
              </p>
            </Show>

            <Show when={stage() === "cancelled"}>
              <p role="alert" class={feedbackEnter}>
                This transfer was cancelled. The tenant's ownership has not changed.
              </p>
            </Show>

            <Show when={stage() === "stale"}>
              <p role="alert" class={feedbackEnter}>
                This transfer is no longer valid because the target is not a member or the
                requesting owner no longer holds that role. Ask a tenant owner to start a new
                transfer.
              </p>
            </Show>

            <Show when={stage() === "accepted"}>
              <p role="status">
                This ownership transfer has already been accepted. The tenant's ownership has
                already moved.
              </p>
            </Show>

            <Show when={stage() === "signed-out"}>
              <p>
                Sign in as the member this transfer was sent to in order to accept ownership of{" "}
                {tenantLabel(preview())}.
              </p>
              <div class="flex flex-col gap-2 sm:flex-row">
                <Button as="a" href={returnTo("/login")} class="min-h-11">
                  Sign in
                </Button>
              </div>
            </Show>

            <Show when={stage() === "wrong-account"}>
              <p role="alert" class={feedbackEnter}>
                You're signed in as <span class="font-medium text-foreground">{user()?.email}</span>
                , but this transfer was sent to{" "}
                <span class="font-medium text-foreground">
                  {preview()?.targetEmailMasked ?? "another address"}
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
                accepting this transfer. The transfer has not been applied.
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
                stage() === "cancelled" ||
                stage() === "stale" ||
                stage() === "accepted"
              }
            >
              <Show
                when={user()}
                fallback={
                  <Button as="a" href={returnTo("/login")} class="min-h-11">
                    Back to sign in
                  </Button>
                }
              >
                <Button as="a" href="/dashboard" class="min-h-11">
                  Go to dashboard
                </Button>
              </Show>
            </Show>

            <Show
              when={stage() === "ready" || stage() === "submitting" || stage() === "accepted-now"}
            >
              <p>
                Signed in as <span class="font-medium text-foreground">{user()?.email}</span>.
                Accepting makes you an owner; the requester becomes an administrator.
              </p>
              <Button
                class="min-h-11 w-full sm:w-auto"
                onClick={() => void accept()}
                pending={accepting()}
                disabled={accepting() || stage() === "accepted-now"}
              >
                {stage() === "accepted-now"
                  ? "Ownership transferred"
                  : accepting()
                    ? `Taking over ${tenantLabel(preview())}…`
                    : `Accept ownership of ${tenantLabel(preview())}`}
              </Button>
              <p role="status" aria-live="polite" class="text-[11px]">
                {accepting() ? `Taking over ${tenantLabel(preview())}…` : ""}
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
