import { useParams } from "@solidjs/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { createEffect, createSignal, For, Show } from "solid-js";
import { ErrorText, LinkButton, PageHeader } from "~/components/mdm/common";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import {
  enterprise,
  enterpriseKeys,
  enterpriseQueries,
  type DeviceRow,
  type PolicyRow,
} from "~/lib/enterprise";

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

  return (
    <div class="flex flex-1 flex-col gap-6 p-6">
      <PageHeader
        title={`Assignments — ${row()?.name ?? "Policy"}`}
        description="Direct device assignments beat group assignments. Excludes veto a policy; group excludes can only be overridden by a direct include of that same policy."
        actions={
          <LinkButton href={`/t/${params.tenantId}/policies/${params.policyId}`} variant="outline">
            Back to policy
          </LinkButton>
        }
      />
      <div class="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">
        <p class="font-medium">Precedence</p>
        <ol class="mt-1 list-decimal space-y-0.5 pl-5">
          <li>A direct device exclude removes the policy, including group includes.</li>
          <li>A direct device include beats any group include or group exclude.</li>
          <li>A group exclude vetoes that policy for every group.</li>
          <li>Between included policies providing the same kind, highest priority wins.</li>
        </ol>
        <p class="mt-2 text-xs">
          Ties go to the most recently updated policy, then the smallest id. This policy has
          priority {row()?.priority ?? 0}.
        </p>
      </div>
      <Show
        when={assignments.data}
        fallback={
          <div class="rounded-xl border bg-white p-6 text-sm text-stone-500">
            <Show when={assignments.isError} fallback={<span>Loading assignments…</span>}>
              <ErrorText error={assignments.error} />
            </Show>
          </div>
        }
      >
        {(value) => (
          <div class="grid gap-6 lg:grid-cols-[360px_1fr]">
            <Card>
              <CardHeader class="border-b">
                <CardTitle class="text-base">Groups</CardTitle>
              </CardHeader>
              <CardContent class="space-y-2">
                <Show
                  when={value().groups.length > 0}
                  fallback={
                    <p class="text-sm text-stone-500">
                      This policy is not assigned to a group. Assign it from a group page.
                    </p>
                  }
                >
                  <For each={value().groups}>
                    {(group) => (
                      <a
                        class="flex items-center justify-between rounded-lg border p-2 text-sm hover:bg-stone-50"
                        href={`/t/${params.tenantId}/groups/${group.id}`}
                      >
                        <span>{group.name}</span>
                        <Badge variant={group.mode === "exclude" ? "destructive" : "secondary"}>
                          {group.mode === "exclude" ? "Group exclude" : "Group include"}
                        </Badge>
                      </a>
                    )}
                  </For>
                </Show>
              </CardContent>
            </Card>
            <Card>
              <CardHeader class="border-b">
                <CardTitle class="text-base">
                  Direct devices <Badge variant="secondary">{includedCount()} included</Badge>
                  <Show when={excludedCount() > 0}>
                    <Badge variant="destructive" class="ml-1">
                      {excludedCount()} excluded
                    </Badge>
                  </Show>
                </CardTitle>
              </CardHeader>
              <CardContent class="space-y-4">
                <Show
                  when={(devices.data?.rows.length ?? 0) > 0}
                  fallback={<p class="text-sm text-stone-500">No devices enrolled yet.</p>}
                >
                  <div class="max-h-96 space-y-1 overflow-auto rounded-lg border p-2">
                    <For each={devices.data?.rows ?? []}>
                      {(device: DeviceRow) => (
                        <label class="flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-stone-50">
                          <span class="flex-1">{device.name}</span>
                          <span class="text-xs text-stone-400">{device.proto}</span>
                          <select
                            class="rounded border bg-white px-2 py-1 text-xs"
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
                  </div>
                </Show>
                <ErrorText error={save.error} />
                <Show when={message()}>
                  {(text) => (
                    <p class="rounded-lg border border-stone-200 bg-stone-50 p-3 text-sm text-stone-600">
                      {text()}
                    </p>
                  )}
                </Show>
                <Button disabled={save.isPending} onClick={() => save.mutate()}>
                  {save.isPending ? "Saving…" : "Save assignments"}
                </Button>
              </CardContent>
            </Card>
          </div>
        )}
      </Show>
    </div>
  );
}
