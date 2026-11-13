import { useParams } from "@solidjs/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import {
  ErrorText,
  LinkButton,
  Page,
  PageHeader,
  Panel,
  QueryError,
} from "~/components/mdm/common";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Search } from "~/components/ui/icons";
import {
  enterprise,
  enterpriseKeys,
  enterpriseQueries,
  type DeviceRow,
  type PolicyRow,
} from "~/lib/enterprise";

const precedence = [
  "A direct device exclude removes the policy, including group includes.",
  "A direct device include beats any group include or group exclude.",
  "A group exclude vetoes that policy for every group.",
  "Between included policies providing the same kind, highest priority wins.",
];

export default function PolicyAssignmentsPage() {
  const params = useParams();
  const qc = useQueryClient();
  const policy = useQuery(() => enterpriseQueries.item(params.tenantId, "policy", params.policyId));
  const assignments = useQuery(() =>
    enterpriseQueries.policyAssignments(params.tenantId, params.policyId),
  );
  const devices = useQuery(() => ({
    queryKey: enterpriseKeys.list(params.tenantId, "device"),
    queryFn: () => enterprise.list(params.tenantId, "device"),
  }));
  const [modes, setModes] = createSignal<Map<string, "include" | "exclude">>(new Map());
  const [message, setMessage] = createSignal<string | null>(null);
  const [filter, setFilter] = createSignal("");
  let seededPolicyId: string | undefined;
  createEffect(
    () => ({ policyId: params.policyId, data: assignments.data }),
    ({ policyId, data }) => {
      if (!data || seededPolicyId === policyId) return;
      seededPolicyId = policyId;
      setModes(new Map(data.devices.map((device) => [device.id, device.mode])));
    },
  );
  const save = useMutation(() => ({
    mutationFn: () => {
      const previous = new Map(
        (assignments.data?.devices ?? []).map((device) => [device.id, device.mode]),
      );
      const next = modes();
      return enterprise.patchPolicyAssignments(params.tenantId, params.policyId, {
        assign: [...next]
          .filter(([id, mode]) => previous.get(id) !== mode)
          .map(([id, mode]) => ({ id, mode })),
        unassign: [...previous.keys()].filter((id) => !next.has(id)),
      });
    },
    onSuccess: async () => {
      setMessage("Direct device assignments saved.");
      await qc.invalidateQueries({
        queryKey: enterpriseKeys.policyAssignments(params.tenantId, params.policyId),
      });
    },
  }));
  const setMode = (id: string, mode: "include" | "exclude" | "") => {
    const next = new Map(modes());
    if (mode) next.set(id, mode);
    else next.delete(id);
    setModes(next);
  };
  const includedCount = () => [...modes().values()].filter((mode) => mode === "include").length;
  const excludedCount = () => [...modes().values()].filter((mode) => mode === "exclude").length;
  const row = () => policy.data as PolicyRow | undefined;

  const deviceRows = createMemo(() => {
    const term = filter().trim().toLowerCase();
    const rows = devices.data?.rows ?? [];
    if (!term) return rows;
    return rows.filter((device) => device.name.toLowerCase().includes(term));
  });

  return (
    <Page>
      <PageHeader
        eyebrow="Policy"
        title={`Assignments — ${row()?.name ?? "Policy"}`}
        description="Direct device assignments beat group assignments. Excludes veto a policy; group excludes can only be overridden by a direct include of that same policy."
        meta={
          <Show when={row()}>
            <span class="tabular-nums">
              Priority <span class="text-foreground">{row()?.priority ?? 0}</span>
            </span>
            <span class="text-muted-foreground/40" aria-hidden="true">
              ·
            </span>
            <span class="tabular-nums">{includedCount()} included</span>
            <Show when={excludedCount() > 0}>
              <span class="text-muted-foreground/40" aria-hidden="true">
                ·
              </span>
              <span class="tabular-nums text-destructive">{excludedCount()} excluded</span>
            </Show>
          </Show>
        }
        actions={
          <LinkButton href={`/t/${params.tenantId}/policies/${params.policyId}`} variant="outline">
            Back to policy
          </LinkButton>
        }
      />

      <QueryError error={policy.error} onRetry={() => void policy.refetch()} />

      <div class="rounded-lg border border-white/[0.08] bg-white/[0.02] p-4">
        <p class="text-[13px] font-semibold text-foreground">Precedence</p>
        <ol class="mt-1.5 list-decimal space-y-0.5 pl-5 text-[12.5px] leading-relaxed text-muted-foreground">
          <For each={precedence}>{(item) => <li>{item}</li>}</For>
        </ol>
        <p class="mt-2 text-[11.5px] text-muted-foreground">
          Ties go to the most recently updated policy, then the smallest id. This policy has
          priority {row()?.priority ?? 0}.
        </p>
      </div>

      <Show
        when={assignments.data}
        fallback={
          <Panel>
            <Show
              when={assignments.isError}
              fallback={
                <div class="space-y-2">
                  <div class="h-4 w-40 animate-pulse rounded bg-muted/60" />
                  <div class="h-24 animate-pulse rounded-lg bg-muted/40" />
                </div>
              }
            >
              <ErrorText error={assignments.error} />
            </Show>
          </Panel>
        }
      >
        {(value) => (
          <div class="grid gap-5 lg:grid-cols-[360px_minmax(0,1fr)] lg:items-start">
            <Panel
              title="Groups"
              description="Assigned from each group's policy list."
              actions={
                <Badge variant="secondary" class="tabular-nums">
                  {value().groups.length}
                </Badge>
              }
            >
              <Show
                when={value().groups.length > 0}
                fallback={
                  <p class="text-[12.5px] leading-relaxed text-muted-foreground">
                    This policy is not assigned to a group. Assign it from a group page.
                  </p>
                }
              >
                <div class="space-y-1.5">
                  <For each={value().groups}>
                    {(group) => (
                      <a
                        class="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/15 px-2.5 py-2 text-[13px] transition-colors hover:border-white/[0.12] hover:bg-muted/40"
                        href={`/t/${params.tenantId}/groups/${group.id}`}
                      >
                        <span class="min-w-0 truncate">{group.name}</span>
                        <Badge
                          variant={group.mode === "exclude" ? "destructive" : "secondary"}
                          class="shrink-0"
                        >
                          {group.mode === "exclude" ? "Group exclude" : "Group include"}
                        </Badge>
                      </a>
                    )}
                  </For>
                </div>
              </Show>
            </Panel>

            <Panel
              title="Direct devices"
              description="Per-device overrides applied before group assignments."
              actions={
                <div class="flex items-center gap-1.5">
                  <Badge variant="secondary" class="tabular-nums">
                    {includedCount()} included
                  </Badge>
                  <Show when={excludedCount() > 0}>
                    <Badge variant="destructive" class="tabular-nums">
                      {excludedCount()} excluded
                    </Badge>
                  </Show>
                </div>
              }
            >
              <div class="space-y-3">
                <Show
                  when={(devices.data?.rows.length ?? 0) > 0}
                  fallback={
                    <Show
                      when={devices.isError}
                      fallback={
                        <p class="text-[12.5px] text-muted-foreground">No devices enrolled yet.</p>
                      }
                    >
                      <QueryError error={devices.error} onRetry={() => void devices.refetch()} />
                    </Show>
                  }
                >
                  <div class="relative max-w-xs">
                    <Search class="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={filter()}
                      onInput={(event) => setFilter(event.currentTarget.value)}
                      placeholder="Filter devices…"
                      aria-label="Filter devices"
                      class="h-8 pl-8 text-[12.5px]"
                    />
                  </div>
                  <div class="max-h-96 divide-y divide-border/60 overflow-auto rounded-lg border border-border">
                    <For each={deviceRows()}>
                      {(device: DeviceRow) => (
                        <label class="flex items-center gap-2 px-2.5 py-1.5 text-[13px] transition-colors hover:bg-muted/30">
                          <span class="min-w-0 flex-1 truncate">{device.name}</span>
                          <span class="shrink-0 text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                            {device.proto}
                          </span>
                          <select
                            class="h-7 shrink-0 rounded-lg px-2 text-[11.5px]"
                            value={modes().get(device.id) ?? ""}
                            onChange={(event) =>
                              setMode(
                                device.id,
                                event.currentTarget.value as "include" | "exclude" | "",
                              )
                            }
                          >
                            <option value="">Not assigned</option>
                            <option value="include">Include</option>
                            <option value="exclude">Exclude</option>
                          </select>
                        </label>
                      )}
                    </For>
                    <Show when={deviceRows().length === 0}>
                      <p class="px-2.5 py-3 text-[12px] text-muted-foreground">
                        No devices match that filter.
                      </p>
                    </Show>
                  </div>
                </Show>
                <ErrorText error={save.error} />
                <Show when={message()}>
                  {(text) => (
                    <p
                      role="status"
                      class="rounded-lg border border-success/25 bg-success/[0.07] px-3 py-2 text-[12.5px] text-success-foreground"
                    >
                      {text()}
                    </p>
                  )}
                </Show>
                <Button disabled={save.isPending} onClick={() => save.mutate()}>
                  {save.isPending ? "Saving…" : "Save assignments"}
                </Button>
              </div>
            </Panel>
          </div>
        )}
      </Show>
    </Page>
  );
}
