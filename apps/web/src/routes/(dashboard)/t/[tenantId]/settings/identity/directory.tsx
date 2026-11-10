import { useParams } from "@solidjs/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { Show } from "solid-js";
import { ErrorText } from "~/components/mdm/common";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { enterprise, enterpriseKeys, enterpriseQueries } from "~/lib/enterprise";

export default function DirectorySyncPage() {
  const params = useParams();
  const qc = useQueryClient();
  const status = useQuery(() => enterpriseQueries.directorySync(params.tenantId));
  const invalidate = async () =>
    qc.invalidateQueries({ queryKey: enterpriseKeys.directorySync(params.tenantId) });
  const toggle = useMutation(() => ({
    mutationFn: (enabled: boolean) =>
      enterprise.patchEntraDirectorySync(params.tenantId, { enabled }),
    onSuccess: invalidate,
  }));
  const sync = useMutation(() => ({
    mutationFn: () => enterprise.syncEntraDirectory(params.tenantId),
    onSuccess: invalidate,
  }));
  const counts = () => status.data?.lastCounts as Record<string, number> | null | undefined;

  return (
    <div class="space-y-4">
      <Card>
        <CardHeader class="border-b">
          <CardTitle class="text-base">Microsoft Entra directory sync</CardTitle>
        </CardHeader>
        <CardContent class="space-y-4 text-sm">
          <Show
            when={status.data}
            fallback={<p class="text-stone-500">Loading directory sync status…</p>}
          >
            {(value) => (
              <>
                <div class="flex flex-wrap items-center gap-2">
                  <Badge variant={value().configured ? "secondary" : "outline"}>
                    {value().configured ? "Graph configured" : "Graph not configured"}
                  </Badge>
                  <Badge variant="secondary">Sync {value().status}</Badge>
                  <Badge variant="secondary">{value().enabled ? "Enabled" : "Disabled"}</Badge>
                  <Show when={value().azureTenantId}>
                    {(tenant) => <span class="font-mono text-xs text-stone-400">{tenant()}</span>}
                  </Show>
                </div>
                <p class="max-w-3xl text-stone-500">
                  Directory sync uses the tenant's Entra ID tenant and the platform app's Graph
                  application permissions to import users and groups. Users are auto-provisioned
                  only when the SSO setting allows it.
                </p>
                <Show when={!value().configured}>
                  <div class="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">
                    Set <code>AZURE_CLIENT_ID</code> and <code>AZURE_CLIENT_SECRET</code>, then
                    grant admin consent for <code>User.Read.All</code>, <code>Group.Read.All</code>{" "}
                    and <code>Domain.Read.All</code>.
                  </div>
                </Show>
                <Show when={value().consentUrl}>
                  {(url) => (
                    <a
                      class="inline-flex text-sm font-medium underline"
                      href={url()}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Grant admin consent in Entra
                    </a>
                  )}
                </Show>
                <div class="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    disabled={!value().configured || toggle.isPending}
                    onClick={() => toggle.mutate(!value().enabled)}
                  >
                    {value().enabled ? "Disable sync" : "Enable sync"}
                  </Button>
                  <Button
                    disabled={!value().configured || sync.isPending}
                    onClick={() => sync.mutate()}
                  >
                    {sync.isPending ? "Syncing…" : "Sync now"}
                  </Button>
                </div>
                <Show when={value().lastSyncedAt}>
                  {(at) => <p class="text-xs text-stone-400">Last synced {at()}</p>}
                </Show>
                <Show when={counts()}>
                  {(value) => (
                    <p class="text-xs text-stone-400">
                      Last run: {value().users ?? 0} users · {value().groups ?? 0} groups ·{" "}
                      {value().domains ?? 0} domains
                    </p>
                  )}
                </Show>
                <Show when={value().lastError}>
                  {(error) => (
                    <p class="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                      {error()}
                    </p>
                  )}
                </Show>
              </>
            )}
          </Show>
          <ErrorText error={sync.error ?? toggle.error} />
        </CardContent>
      </Card>
    </div>
  );
}
