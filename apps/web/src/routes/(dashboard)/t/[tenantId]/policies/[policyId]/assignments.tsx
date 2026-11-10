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
  const [deviceIds, setDeviceIds] = createSignal<Set<string>>(new Set());
  const [message, setMessage] = createSignal<string | null>(null);
  createEffect(
    () => assignments.data,
    (value) => {
      setDeviceIds(new Set(value?.devices.map((device) => device.id) ?? []));
    },
  );
  const save = useMutation(() => ({
    mutationFn: () => {
      const old = assignments.data?.devices.map((device) => device.id) ?? [];
      return enterprise.patchPolicyAssignments(params.tenantId, params.policyId, {
        assign: [...deviceIds()].filter((id) => !old.includes(id)),
        unassign: old.filter((id) => !deviceIds().has(id)),
      });
    },
    onSuccess: async () => {
      setMessage("Direct device assignments saved.");
      await qc.invalidateQueries({
        queryKey: enterpriseKeys.policyAssignments(params.tenantId, params.policyId),
      });
    },
  }));
  const toggle = (id: string) => {
    const next = new Set(deviceIds());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setDeviceIds(next);
  };
  const row = () => policy.data as PolicyRow | undefined;

  return (
    <div class="flex flex-1 flex-col gap-6 p-6">
      <PageHeader
        title={`Assignments — ${row()?.name ?? "Policy"}`}
        description="Group assignments deliver the policy to every member. Direct device assignments are additive."
        actions={
          <LinkButton href={`/t/${params.tenantId}/policies/${params.policyId}`} variant="outline">
            Back to policy
          </LinkButton>
        }
      />
      <Show
        when={assignments.data}
        fallback={
          <div class="rounded-xl border bg-white p-6 text-sm text-stone-500">
            Loading assignments…
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
                        <Badge variant="secondary">Group</Badge>
                      </a>
                    )}
                  </For>
                </Show>
              </CardContent>
            </Card>
            <Card>
              <CardHeader class="border-b">
                <CardTitle class="text-base">
                  Direct devices <Badge variant="secondary">{deviceIds().size}</Badge>
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
                          <input
                            type="checkbox"
                            checked={deviceIds().has(device.id)}
                            onChange={() => toggle(device.id)}
                          />
                          <span class="flex-1">{device.name}</span>
                          <span class="text-xs text-stone-400">{device.proto}</span>
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
