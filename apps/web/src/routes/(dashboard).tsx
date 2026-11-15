import { useLocation, useNavigate } from "@solidjs/router";
import { QueryClientProvider, useQuery, useQueryClient } from "@tanstack/solid-query";
import { isServer } from "@solidjs/web";
import { createEffect, createSignal, Errored, type ParentProps, onSettled, Show } from "solid-js";
import { AppShell } from "~/components/app-shell";
import { PageErrorFallback } from "~/components/error-boundary";
import { QueryError } from "~/components/mdm/common";
import { CommandPalette } from "~/components/command-palette";
import { StepUpDialog } from "~/components/step-up-dialog";
import { authClient } from "~/lib/auth";
import { queryClient } from "~/lib/query-client";
import { broadcastCacheReset, setCrossTabTenant } from "~/lib/cross-tab-sync";
import { meQueryOptions } from "~/lib/enterprise";
import { errorTag, raisedFailure } from "~/lib/errors";
import { clearMeCache } from "~/lib/me-cache";
import { reportGlobalError } from "~/lib/global-errors";
import { syncPostHogTenant, syncPostHogUser } from "~/lib/posthog";
import { clearSessionPresence, readSessionPresence } from "~/lib/session-presence";

function DashboardBootScreen() {
  return (
    <div class="flex min-h-svh items-center justify-center bg-background text-foreground">
      <div class="flex flex-col items-center gap-3">
        <span class="flex size-9 animate-pulse items-center justify-center rounded-xl bg-primary text-[14px] font-bold text-primary-foreground">
          M
        </span>
        <p class="text-[12px] text-muted-foreground">Loading your tenant…</p>
      </div>
    </div>
  );
}

function DashboardLayout(props: ParentProps) {
  const session = authClient.useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [presenceTick, setPresenceTick] = createSignal(0);
  onSettled(() => {
    const recheck = () => setPresenceTick((value) => value + 1);
    window.addEventListener("focus", recheck);
    document.addEventListener("visibilitychange", recheck);

    return () => {
      window.removeEventListener("focus", recheck);
      document.removeEventListener("visibilitychange", recheck);
    };
  });

  const presenceState = () => {
    presenceTick();

    return readSessionPresence().state;
  };

  const presenceActive = () => presenceState() === "active";

  const canLoadSession = () =>
    Boolean(session().data?.user) || (session().isPending && presenceActive());

  // Session claims are a snapshot from sign-in. `me` reads the user row so a
  // verification completed in this tab takes effect without signing out.
  const me = useQuery(() =>
    meQueryOptions(session().data?.user?.id, !isServer && canLoadSession()),
  );

  const unauthorized = () =>
    me.isError && errorTag(raisedFailure(me.error)) === "EnterpriseUnauthorized";

  const shellUser = () =>
    session().data?.user ?? (session().isPending && presenceActive() ? me.data?.user : undefined);

  createEffect(
    () => ({
      pending: session().isPending,
      user: session().data?.user,
      verified: me.data?.user.emailVerified,
      unauthorized: unauthorized(),
      presence: presenceState(),
      path: `${location.pathname}${location.search}`,
    }),
    ({ pending, user, verified, unauthorized, presence, path }) => {
      const login = () => {
        clearSessionPresence();
        clearMeCache();
        queryClient.clear();
        // Every tab shares the session cookie, so a sign-out must drop the
        // other tabs' caches too rather than leaving stale device data on screen.
        broadcastCacheReset(null);
        setCrossTabTenant(null);
        navigate(`/login?returnTo=${encodeURIComponent(path)}`, { replace: true });
      };

      if (presence === "expired") {
        void session().refetch();
        login();

        return;
      }

      if (pending) {
        // The shadow cookie is a fast path only: a present session still wins.
        // Without one there is no reason to wait for a session HTTP request.
        if (presence !== "active") login();

        return;
      }

      if (!user) {
        login();

        return;
      }

      if (unauthorized) {
        void session().refetch();
        login();

        return;
      }

      if (verified === undefined) return;

      if (!verified) {
        navigate(`/verify-email?returnTo=${encodeURIComponent(path)}`, { replace: true });
      }
    },
  );

  createEffect(
    () => /^\/t\/([^/]+)/.exec(location.pathname)?.[1],
    (tenantId) => syncPostHogTenant(tenantId),
  );

  const handleSignOut = async () => {
    try {
      const result = await authClient.signOut();

      if (result.error) {
        reportGlobalError(result.error);

        return;
      }
    } catch (error) {
      reportGlobalError(raisedFailure(error));

      return;
    }

    queryClient.clear();
    broadcastCacheReset(null);
    setCrossTabTenant(null);
    navigate("/login", { replace: true });
  };

  return (
    <Show
      when={!unauthorized() ? shellUser() : undefined}
      fallback={
        unauthorized() ? null : session().isPending && presenceActive() ? (
          <DashboardBootScreen />
        ) : null
      }
    >
      {(user) => (
        <Show
          when={!me.isError || me.data}
          fallback={
            <div class="flex min-h-svh items-center justify-center bg-background p-6 text-foreground">
              <QueryError
                class="w-full max-w-md"
                error={me.error}
                onRetry={() => void me.refetch()}
              />
            </div>
          }
        >
          <AppShell user={user()} onSignOut={handleSignOut}>
            {props.children}
            <CommandPalette />
            <StepUpDialog />
          </AppShell>
        </Show>
      )}
    </Show>
  );
}

/**
 * Keep browser analytics identity aligned with the dashboard session. The
 * server-side API capture uses the authenticated id; this makes browser
 * pageviews, session ids and server events resolve to the same person.
 */
function PostHogIdentity() {
  const session = authClient.useSession();
  createEffect(
    () => {
      const state = session();

      return state.isPending ? undefined : (state.data?.user ?? null);
    },
    (user) => {
      if (user !== undefined) syncPostHogUser(user);
    },
  );

  return null;
}

export default function DashboardRoute(props: ParentProps) {
  return (
    <QueryClientProvider client={queryClient}>
      <PostHogIdentity />
      <Errored
        fallback={(error, reset) => (
          <PageErrorFallback boundary="dashboard" error={error()} reset={reset} />
        )}
      >
        <DashboardLayout {...props} />
      </Errored>
    </QueryClientProvider>
  );
}
