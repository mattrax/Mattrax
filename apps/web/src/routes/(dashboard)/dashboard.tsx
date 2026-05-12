import { authClient } from "~/lib/auth";

export default function DashboardPage() {
  const session = authClient.useSession();
  const user = () => session().data?.user;

  return (
    <div class="flex flex-1 flex-col gap-4 p-4">
      <div class="rounded-xl border border-border bg-card p-6">
        <h2 class="text-lg font-semibold mb-4">Welcome back</h2>
        <dl class="grid grid-cols-[max-content_1fr] gap-x-8 gap-y-3 text-sm">
          <dt class="text-muted-foreground">Name</dt>
          <dd class="font-medium">{user()?.name}</dd>

          <dt class="text-muted-foreground">Email</dt>
          <dd class="font-medium">{user()?.email}</dd>

          <dt class="text-muted-foreground">Email verified</dt>
          <dd class="font-medium">{user()?.emailVerified ? "Yes" : "No"}</dd>

          <dt class="text-muted-foreground">User ID</dt>
          <dd class="font-mono text-xs text-muted-foreground">{user()?.id}</dd>
        </dl>
      </div>

      <div class="grid auto-rows-min gap-4 md:grid-cols-3">
        <div class="aspect-video rounded-xl bg-muted/50" />
        <div class="aspect-video rounded-xl bg-muted/50" />
        <div class="aspect-video rounded-xl bg-muted/50" />
      </div>
      <div class="min-h-[400px] flex-1 rounded-xl bg-muted/50" />
    </div>
  );
}
