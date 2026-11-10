import { useParams } from "@solidjs/router";
import { useQuery } from "@tanstack/solid-query";
import { For, Show } from "solid-js";
import { ErrorText, QueryError } from "~/components/mdm/common";
import { Badge } from "~/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { enterprise, enterpriseKeys } from "~/lib/enterprise";

const formatAction = (action: string) =>
  action
    .split(".")
    .map((part) => part.replaceAll("_", " "))
    .join(" · ")
    .replace(/^\w/, (letter) => letter.toUpperCase());

const formatDate = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
};

export default function AuditSettingsPage() {
  const params = useParams();
  const log = useQuery(() => ({
    queryKey: enterpriseKeys.auditLog(params.tenantId),
    queryFn: () => enterprise.listAuditLog(params.tenantId),
  }));

  return (
    <div class="space-y-6">
      <QueryError error={log.error} onRetry={() => void log.refetch()} />
      <Card>
        <CardHeader>
          <CardTitle>Audit log</CardTitle>
          <p class="text-sm text-muted-foreground">
            A chronological record of tenant changes. Entries are append-only and retained for the
            lifetime of the tenant.
          </p>
        </CardHeader>
        <CardContent>
          <Show
            when={(log.data?.entries.length ?? 0) > 0}
            fallback={
              <p class="text-sm text-muted-foreground">
                {log.isPending ? "Loading audit events…" : "No audit events recorded yet."}
              </p>
            }
          >
            <div class="overflow-x-auto">
              <table class="w-full text-left text-sm">
                <thead class="border-b text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th class="px-2 py-2 font-medium">When</th>
                    <th class="px-2 py-2 font-medium">Actor</th>
                    <th class="px-2 py-2 font-medium">Action</th>
                    <th class="px-2 py-2 font-medium">Target</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={log.data?.entries ?? []}>
                    {(entry) => (
                      <tr class="border-b last:border-0">
                        <td class="whitespace-nowrap px-2 py-3 text-muted-foreground">
                          {formatDate(entry.createdAt)}
                        </td>
                        <td class="px-2 py-3">{entry.actorEmail ?? "System"}</td>
                        <td class="px-2 py-3">
                          <span class="flex items-center gap-2">
                            <Badge variant="secondary">{formatAction(entry.action)}</Badge>
                          </span>
                        </td>
                        <td class="px-2 py-3 text-muted-foreground">
                          <span class="block">{entry.targetType}</span>
                          <Show when={entry.targetId}>
                            <code class="text-xs">{entry.targetId}</code>
                          </Show>
                        </td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>
          </Show>
          <ErrorText error={log.error} />
        </CardContent>
      </Card>
    </div>
  );
}
