import { useParams } from "@solidjs/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { For, Show } from "solid-js";
import { ErrorText } from "~/components/mdm/common";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { enterprise, enterpriseKeys, enterpriseQueries } from "~/lib/enterprise";

export default function DomainsPage() {
  const params = useParams();
  const qc = useQueryClient();
  const domains = useQuery(() => enterpriseQueries.domains(params.tenantId));
  const refresh = useMutation(() => ({
    mutationFn: () => enterprise.refreshEntraDomains(params.tenantId),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: enterpriseKeys.domains(params.tenantId) });
    },
  }));

  return (
    <Card>
      <CardHeader class="flex flex-row items-center justify-between border-b">
        <CardTitle class="text-base">Verified domains</CardTitle>
        <Button variant="outline" disabled={refresh.isPending} onClick={() => refresh.mutate()}>
          {refresh.isPending ? "Refreshing…" : "Refresh from Entra"}
        </Button>
      </CardHeader>
      <CardContent class="space-y-4 text-sm">
        <p class="text-stone-500">
          Verified Entra domains route sign-in by email domain before a user has a Mattrax account.
          Only Microsoft-verified, non-initial domains are imported.
        </p>
        <Show
          when={(domains.data?.domains.length ?? 0) > 0}
          fallback={
            <p class="rounded-lg border border-dashed p-4 text-stone-500">
              No verified domains yet. Enable SSO, grant Graph consent, then refresh.
            </p>
          }
        >
          <div class="divide-y rounded-lg border">
            <For each={domains.data?.domains ?? []}>
              {(domain) => (
                <div class="flex items-center justify-between p-3">
                  <span class="font-medium">{domain.domain}</span>
                  <span class="flex items-center gap-2">
                    <Badge variant="secondary">{domain.source}</Badge>
                    <Badge variant={domain.isVerified ? "default" : "outline"}>
                      {domain.isVerified ? "Verified" : "Unverified"}
                    </Badge>
                  </span>
                </div>
              )}
            </For>
          </div>
        </Show>
        <ErrorText error={refresh.error} />
      </CardContent>
    </Card>
  );
}
