import { useLocation, useNavigate } from "@solidjs/router";
import { createEffect, type ParentProps, Show } from "solid-js";
import { AppShell } from "~/components/app-shell";
import { CommandPalette } from "~/components/command-palette";
import { StepUpDialog } from "~/components/step-up-dialog";
import { authClient } from "~/lib/auth";

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

  createEffect(
    () => ({
      pending: session().isPending,
      user: session().data?.user,
      path: `${location.pathname}${location.search}`,
    }),
    ({ pending, user, path }) => {
      if (!pending && !user) {
        navigate(`/login?returnTo=${encodeURIComponent(path)}`, { replace: true });
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
