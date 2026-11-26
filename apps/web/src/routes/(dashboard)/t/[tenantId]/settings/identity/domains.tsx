import { useParams } from "@solidjs/router";
import type { RoutePreloadFuncArgs } from "@solidjs/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { For, Show } from "solid-js";
import { ErrorText, Panel } from "~/components/mdm/common";
import { Button } from "~/components/ui/button";
import { enterprise, enterpriseKeys, enterpriseQueries } from "~/lib/enterprise";
import { preloadPage } from "~/lib/page-data";
import { queryClient } from "~/lib/query-client";
import { useCan } from "~/lib/permissions";
import Chip from "~/components/settings/status-chip";

export const route = {
  preload: ({ params, intent }: RoutePreloadFuncArgs) => {
    if (intent === "initial") return;

    return preloadPage([
      () => queryClient.ensureQueryData(enterpriseQueries.domains(params.tenantId)),
    ]);
  },
};

export default function DomainsPage() {
  const params = useParams();
  const qc = useQueryClient();
  const { can } = useCan();
  const domains = useQuery(() => enterpriseQueries.domains(params.tenantId));

  const refresh = useMutation(() => ({
    meta: { inlineError: true },
    mutationFn: () => enterprise.refreshEntraDomains(params.tenantId),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: enterpriseKeys.domains(params.tenantId) });
    },
  }));

  return (
    <Panel
      title="Verified domains"
      description="Verified Entra domains route sign-in by email domain before a user has a Mattrax account. Only Microsoft-verified, non-initial domains are imported."
      actions={
        <Show when={can("identity.write")}>
          <Button
            variant="outline"
            disabled={refresh.isPending}
            title="Requires a connected Microsoft Graph application"
            onClick={() => refresh.mutate()}
          >
            {refresh.isPending ? "Refreshing…" : "Refresh from Entra"}
          </Button>
        </Show>
      }
      flush
    >
      <Show
        when={(domains.data?.domains.length ?? 0) > 0}
        fallback={
          <div class="px-4 py-8 text-center sm:px-5">
            <p class="text-xs font-medium text-foreground">No verified domains yet</p>
            <p class="mx-auto mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">
              Domains are imported from Microsoft Entra. Connect SSO, grant Graph consent, then
              refresh. Users can still sign in with a passkey until a domain is verified.
            </p>
            <a
              href={`/t/${params.tenantId}/settings/identity`}
              class="mt-3 inline-flex min-h-9 items-center rounded-lg border border-border px-3 text-xs font-medium text-foreground transition-colors hover:bg-hover"
            >
              Open SSO settings
            </a>
          </div>
        }
      >
        <ul class="divide-y divide-border">
          <For each={domains.data?.domains ?? []}>
            {(domain) => (
              <li class="flex flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-5">
                <span class="min-w-0 break-all text-xs font-medium text-foreground">
                  {domain.domain}
                </span>
                <span class="flex shrink-0 items-center gap-2">
                  <Chip tone="neutral">{domain.source}</Chip>
                  <Chip tone={domain.isVerified ? "success" : "warning"}>
                    {domain.isVerified ? "Verified" : "Unverified"}
                  </Chip>
                </span>
              </li>
            )}
          </For>
        </ul>
      </Show>
      <div class="px-4 pb-4 sm:px-5">
        <ErrorText error={refresh.error ?? domains.error} />
      </div>
    </Panel>
  );
}
