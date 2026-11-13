import { useLocation, useNavigate } from "@solidjs/router";
import { useQuery } from "@tanstack/solid-query";
import { isServer } from "@solidjs/web";
import { createEffect, type ParentProps, Show } from "solid-js";
import { AppShell } from "~/components/app-shell";
import { CommandPalette } from "~/components/command-palette";
import { StepUpDialog } from "~/components/step-up-dialog";
import { authClient } from "~/lib/auth";
import { enterprise, enterpriseKeys } from "~/lib/enterprise";

function DashboardBootScreen() {
  return (
    <div class="dark flex min-h-svh items-center justify-center bg-background text-foreground">
      <div class="flex flex-col items-center gap-3">
        <span class="flex size-9 animate-pulse items-center justify-center rounded-xl bg-gradient-to-b from-white to-white/80 text-[14px] font-bold text-black">
          M
        </span>
        <p class="text-[12px] text-muted-foreground">Loading your tenant…</p>
      </div>
    </div>
  );
}

export default function DashboardLayout(props: ParentProps) {
  const session = authClient.useSession();
  const navigate = useNavigate();
  const location = useLocation();
  // Session claims are a snapshot from sign-in. `me` reads the user row so a
  // verification completed in this tab takes effect without signing out.
  const me = useQuery(() => ({
    queryKey: enterpriseKeys.me(),
    queryFn: enterprise.me,
    // The server render has no reliable request context for this query; hydrate
    // first and let the browser fetch it with the session cookie.
    enabled: !isServer && Boolean(session().data?.user),
  }));

  createEffect(
    () => ({
      pending: session().isPending,
      user: session().data?.user,
      mePending: me.isPending,
      verified: me.data?.user.emailVerified,
      path: `${location.pathname}${location.search}`,
    }),
    ({ pending, user, mePending, verified, path }) => {
      if (pending) return;
      if (!user) {
        navigate(`/login?returnTo=${encodeURIComponent(path)}`, { replace: true });
        return;
      }
      if (mePending || verified === undefined) return;
      if (!verified) {
        navigate(`/verify-email?returnTo=${encodeURIComponent(path)}`, { replace: true });
      }
    },
  );

  const handleSignOut = async () => {
    await authClient.signOut();
    navigate("/login", { replace: true });
  };

  return (
    <Show when={session().data?.user} fallback={<DashboardBootScreen />}>
      {(user) => (
        <AppShell user={user()} onSignOut={handleSignOut}>
          {props.children}
          <CommandPalette />
          <StepUpDialog />
        </AppShell>
      )}
    </Show>
  );
}
