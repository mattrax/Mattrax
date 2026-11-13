import { useLocation, useNavigate } from "@solidjs/router";
import { createEffect, type ParentProps } from "solid-js";
import { AppShell } from "~/components/app-shell";
import { CommandPalette } from "~/components/command-palette";
import { StepUpDialog } from "~/components/step-up-dialog";
import { authClient } from "~/lib/auth";

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
    <AppShell user={session().data?.user} onSignOut={handleSignOut}>
      {props.children}
      <CommandPalette />
      <StepUpDialog />
    </AppShell>
  );
}
