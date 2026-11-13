import { useNavigate, useParams } from "@solidjs/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { createSignal, For, Show } from "solid-js";
import { ErrorText, Field, Page, PageHeader, Panel, QueryError } from "~/components/mdm/common";
import { GroupRuleBuilder } from "~/components/mdm/group-rules";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  enterprise,
  enterpriseKeys,
  type DynamicGroupKind,
  type DynamicGroupRules,
} from "~/lib/enterprise";

export default function NewGroupPage() {
  const params = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [name, setName] = createSignal("");
  const [notes, setNotes] = createSignal("");
  const [kind, setKind] = createSignal<DynamicGroupKind>("manual");
  const [rules, setRules] = createSignal<DynamicGroupRules>({ version: 1 });
  const [devices, setDevices] = createSignal<Set<string>>(new Set());
  const [policies, setPolicies] = createSignal<Set<string>>(new Set());
  const deviceList = useQuery(() => ({
    queryKey: enterpriseKeys.list(params.tenantId, "device"),
    queryFn: () => enterprise.list(params.tenantId, "device"),
  }));
  const policyList = useQuery(() => ({
    queryKey: enterpriseKeys.list(params.tenantId, "policy"),
    queryFn: () => enterprise.list(params.tenantId, "policy"),
  }));
  const create = useMutation(() => ({
    mutationFn: () =>
      enterprise.createGroup(params.tenantId, {
        name: name(),
        notes: notes() || null,
        kind: kind(),
        rules: kind() === "dynamic" ? rules() : null,
        devices: kind() === "manual" ? [...devices()] : [],
        policies: [...policies()],
      }),
    onSuccess: async ({ id }) => {
      await qc.invalidateQueries({ queryKey: enterpriseKeys.list(params.tenantId, "group") });
      navigate(`/t/${params.tenantId}/groups/${id}`);
    },
  }));
  const toggle = (set: () => Set<string>, update: (v: Set<string>) => void, id: string) => {
    const next = new Set(set());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    update(next);
  };
  return (
    <Page>
      <PageHeader
        title="Create group"
        description="Create a reusable deployment target and optionally scope it now."
      />
      <form
        class="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,330px)]"
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate();
        }}
      >
        <Panel
          title="Group details"
          description="Name the target, then choose how devices become members."
          class="min-w-0"
        >
          <div class="space-y-4">
            <Field label="Name">
              <Input required value={name()} onInput={(e) => setName(e.currentTarget.value)} />
            </Field>
            <Field label="Notes" hint="Optional context for other administrators.">
              <textarea
                class="min-h-28 rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30"
                value={notes()}
                onInput={(e) => setNotes(e.currentTarget.value)}
                placeholder="What is this group for?"
              />
            </Field>
            <Field label="Membership">
              <select
                class="h-8 rounded-lg px-2.5 pr-8 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/30"
                value={kind()}
                onChange={(e) => setKind(e.currentTarget.value as DynamicGroupKind)}
              >
                <option value="manual">Manual — choose devices</option>
                <option value="dynamic">Dynamic — match device rules</option>
              </select>
            </Field>
            <Show when={kind() === "dynamic"}>
              <div class="rounded-lg border border-white/[0.07] bg-white/[0.02] p-3">
                <GroupRuleBuilder rules={rules()} onChange={setRules} />
              </div>
            </Show>
            <ErrorText error={create.error} />
            <div class="flex flex-wrap items-center gap-2 border-t border-white/[0.06] pt-4">
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? "Creating…" : "Create group"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => navigate(`/t/${params.tenantId}/groups`)}
              >
                Cancel
              </Button>
            </div>
          </div>
        </Panel>

        <div class="min-w-0 space-y-5">
          <Panel
            flush
            title="Devices"
            description={
              kind() === "dynamic"
                ? "Membership is computed from the rules."
                : "Pick devices to include now."
            }
            actions={
              <Badge variant="secondary" class="tabular-nums">
                {kind() === "dynamic" ? "rule-based" : devices().size}
              </Badge>
            }
          >
            <Show
              when={kind() === "manual"}
              fallback={
                <p class="px-4 py-4 text-[12.5px] leading-relaxed text-muted-foreground sm:px-5">
                  Membership is computed from the rules above. You can preview matches after the
                  group is created.
                </p>
              }
            >
              <Show
                when={(deviceList.data?.rows.length ?? 0) > 0}
                fallback={
                  <Show
                    when={deviceList.isError}
                    fallback={
                      <p class="px-4 py-4 text-[12.5px] text-muted-foreground sm:px-5">
                        No devices enrolled yet.
                      </p>
                    }
                  >
                    <div class="p-4 sm:p-5">
                      <QueryError
                        error={deviceList.error}
                        onRetry={() => void deviceList.refetch()}
                      />
                    </div>
                  </Show>
                }
              >
                <div class="max-h-64 divide-y divide-white/[0.05] overflow-auto">
                  <For each={deviceList.data?.rows ?? []}>
                    {(device) => (
                      <label class="flex cursor-pointer items-center gap-2.5 px-4 py-2 text-[12.5px] transition-colors hover:bg-white/[0.03] sm:px-5">
                        <input
                          type="checkbox"
                          class="size-3.5 shrink-0 accent-[var(--brand)]"
                          checked={devices().has(device.id)}
                          onChange={() => toggle(devices, setDevices, device.id)}
                        />
                        <span class="min-w-0 flex-1 truncate">{device.name}</span>
                        <span class="shrink-0 font-mono text-[10.5px] text-muted-foreground">
                          {device.serial ?? ""}
                        </span>
                      </label>
                    )}
                  </For>
                </div>
              </Show>
            </Show>
          </Panel>
          <Panel
            flush
            title="Policies"
            description="Attach policies to deploy to members."
            actions={
              <Badge variant="secondary" class="tabular-nums">
                {policies().size}
              </Badge>
            }
          >
            <Show
              when={(policyList.data?.rows.length ?? 0) > 0}
              fallback={
                <Show
                  when={policyList.isError}
                  fallback={
                    <p class="px-4 py-4 text-[12.5px] text-muted-foreground sm:px-5">
                      No policies yet.
                    </p>
                  }
                >
                  <div class="p-4 sm:p-5">
                    <QueryError
                      error={policyList.error}
                      onRetry={() => void policyList.refetch()}
                    />
                  </div>
                </Show>
              }
            >
              <div class="max-h-64 divide-y divide-white/[0.05] overflow-auto">
                <For each={policyList.data?.rows ?? []}>
                  {(policy) => (
                    <label class="flex cursor-pointer items-center gap-2.5 px-4 py-2 text-[12.5px] transition-colors hover:bg-white/[0.03] sm:px-5">
                      <input
                        type="checkbox"
                        class="size-3.5 shrink-0 accent-[var(--brand)]"
                        checked={policies().has(policy.id)}
                        onChange={() => toggle(policies, setPolicies, policy.id)}
                      />
                      <span class="min-w-0 flex-1 truncate">{policy.name}</span>
                      <span class="shrink-0 text-[10.5px] tabular-nums text-muted-foreground">
                        priority {policy.priority}
                      </span>
                    </label>
                  )}
                </For>
              </div>
            </Show>
          </Panel>
        </div>
      </form>
    </Page>
  );
}
