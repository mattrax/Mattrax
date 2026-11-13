import { useParams } from "@solidjs/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { For, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import { ErrorText, Panel } from "~/components/mdm/common";
import { Button } from "~/components/ui/button";
import { enterprise, enterpriseKeys, enterpriseQueries } from "~/lib/enterprise";
import { cn } from "~/lib/utils";

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
    <Panel
      title="Verified domains"
      description="Verified Entra domains route sign-in by email domain before a user has a Mattrax account. Only Microsoft-verified, non-initial domains are imported."
      actions={
        <Button variant="outline" disabled={refresh.isPending} onClick={() => refresh.mutate()}>
          {refresh.isPending ? "Refreshing…" : "Refresh from Entra"}
        </Button>
      }
      flush
    >
      <Show
        when={(domains.data?.domains.length ?? 0) > 0}
        fallback={
          <p class="px-4 py-8 text-center text-[13px] text-muted-foreground sm:px-5">
            No verified domains yet. Enable SSO, grant Graph consent, then refresh.
          </p>
        }
      >
        <ul class="divide-y divide-white/[0.05]">
          <For each={domains.data?.domains ?? []}>
            {(domain) => (
              <li class="flex flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-5">
                <span class="min-w-0 break-all text-[13px] font-medium text-foreground">
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

const chipTones = {
  neutral: "border-white/[0.08] bg-white/[0.03] text-muted-foreground",
  success: "border-success/25 bg-success/10 text-success-foreground",
  warning: "border-warning/25 bg-warning/10 text-warning-foreground",
  danger: "border-destructive/25 bg-destructive/10 text-destructive",
} as const;

function Chip(props: { tone: keyof typeof chipTones; children: JSX.Element }) {
  return (
    <span
      class={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium",
        chipTones[props.tone],
      )}
    >
      <span class="size-1.5 rounded-full bg-current" aria-hidden="true" />
      {props.children}
    </span>
  );
}
