import { useNavigate, useParams } from "@solidjs/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import {
  ErrorText,
  Field,
  Page,
  PageHeader,
  Panel,
  QueryError,
  formatDate,
} from "~/components/mdm/common";
import { GroupRuleBuilder } from "~/components/mdm/group-rules";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Info, ShieldCheck, UsersRound } from "~/components/ui/icons";
import { Input } from "~/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import {
  enterprise,
  enterpriseKeys,
  type DeviceRow,
  type DynamicGroupKind,
  type DynamicGroupRules,
  type GroupNode,
  type PolicyRow,
} from "~/lib/enterprise";

export default function GroupDetailPage() {
  const params = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const group = useQuery(() => ({
    queryKey: enterpriseKeys.item(params.tenantId, "group", params.groupId),
    queryFn: () => enterprise.get(params.tenantId, "group", params.groupId),
  }));

  // Viewing a group only needs its own devices. The full tenant list is loaded
  // lazily when editing, because the picker must also offer unassigned devices.
  const groupDevices = useQuery(() => ({
    queryKey: enterpriseKeys.deviceSearch(params.tenantId, {
      groupId: params.groupId,
      limit: 200,
      sort: "name",
    }),
    queryFn: () =>
      enterprise.searchDevices(params.tenantId, {
        groupId: params.groupId,
        limit: 200,
        sort: "name",
      }),
  }));

  const policies = useQuery(() => ({
    queryKey: enterpriseKeys.list(params.tenantId, "policy"),
    queryFn: () => enterprise.list(params.tenantId, "policy"),
  }));

  const preview = useQuery(() => ({
    queryKey: [...enterpriseKeys.item(params.tenantId, "group", params.groupId), "preview"],
    queryFn: () => enterprise.previewGroup(params.tenantId, params.groupId),
  }));

  const row = () => group.data as GroupNode | undefined;
  const [edit, setEdit] = createSignal(false);

  // The full tenant list is only needed while editing, because the picker must
  // offer unassigned devices too.
  const allDevices = useQuery(() => ({
    queryKey: enterpriseKeys.list(params.tenantId, "device"),
    queryFn: () => enterprise.list(params.tenantId, "device"),
    enabled: edit(),
  }));

  const deviceRows = () =>
    edit() ? (allDevices.data?.rows ?? []) : (groupDevices.data?.devices ?? []);

  const deviceTotal = () =>
    edit() ? (allDevices.data?.rows.length ?? 0) : (groupDevices.data?.total ?? 0);

  const [deleteOpen, setDeleteOpen] = createSignal(false);
  const [deleteConfirm, setDeleteConfirm] = createSignal("");
  const [tab, setTab] = createSignal<"overview" | "devices" | "policies">("overview");
  const [name, setName] = createSignal("");
  const [notes, setNotes] = createSignal("");
  const [kind, setKind] = createSignal<DynamicGroupKind>("manual");
  const [rules, setRules] = createSignal<DynamicGroupRules>({ version: 1 });
  const [deviceIds, setDeviceIds] = createSignal<Set<string>>(new Set());
  const [policyModes, setPolicyModes] = createSignal<Map<string, "include" | "exclude">>(new Map());
  createEffect(
    () => ({ row: row(), edit: edit() }),
    ({ row, edit }) => {
      if (row && !edit) {
        setName(row.name);
        setNotes(row.notes ?? "");
        setKind(row.kind ?? "manual");
        setRules(row.rules ?? { version: 1 });
        setDeviceIds(new Set(row.devices?.map((d) => d.id) ?? []));
        setPolicyModes(
          new Map(
            (row.policies ?? []).map((policy) => [policy.id, policy.mode ?? ("include" as const)]),
          ),
        );
      }
    },
  );

  const policySignature = (policies: ReadonlyArray<{ id: string; mode?: string }>) =>
    policies
      .map((policy) => `${policy.id}:${policy.mode ?? "include"}`)
      .sort()
      .join(",");

  const currentPolicySignature = () =>
    [...policyModes()]
      .map(([id, mode]) => `${id}:${mode}`)
      .sort()
      .join(",");

  const kindChanged = () => kind() !== (row()?.kind ?? "manual");

  const rulesChanged = () =>
    JSON.stringify(rules()) !== JSON.stringify(row()?.rules ?? { version: 1 });

  const dirty = createMemo(
    () =>
      row() &&
      (name() !== row()!.name ||
        notes() !== (row()!.notes ?? "") ||
        kindChanged() ||
        rulesChanged() ||
        (kind() === "manual" &&
          [...deviceIds()].sort().join(",") !==
            (row()!
              .devices?.map((d) => d.id)
              .sort()
              .join(",") ?? "")) ||
        currentPolicySignature() !== policySignature(row()!.policies ?? [])),
  );

  const invalidate = async () => {
    await qc.invalidateQueries({
      queryKey: enterpriseKeys.item(params.tenantId, "group", params.groupId),
    });
    await qc.invalidateQueries({ queryKey: enterpriseKeys.list(params.tenantId, "group") });
    await qc.invalidateQueries({
      queryKey: [...enterpriseKeys.item(params.tenantId, "group", params.groupId), "preview"],
    });
  };

  const save = useMutation(() => ({
    mutationFn: async () => {
      const oldDevices = row()?.devices?.map((d) => d.id) ?? [];

      const oldPolicies = new Map(
        (row()?.policies ?? []).map((policy) => [policy.id, policy.mode ?? "include"]),
      );

      const nextDevices = kind() === "dynamic" ? oldDevices : [...deviceIds()];
      const nextPolicies = policyModes();

      if (
        name() !== row()?.name ||
        notes() !== (row()?.notes ?? "") ||
        kindChanged() ||
        rulesChanged()
      )
        await enterprise.patchGroup(params.tenantId, params.groupId, {
          name: name(),
          notes: notes() || null,
          kind: kind(),
          rules: kind() === "dynamic" ? rules() : null,
        });
      await enterprise.patchGroupMembers(params.tenantId, params.groupId, {
        assign: {
          devices: nextDevices.filter((id) => !oldDevices.includes(id)),
          policies: [...nextPolicies]
            .filter(([id, mode]) => oldPolicies.get(id) !== mode)
            .map(([id, mode]) => ({ id, mode })),
        },
        unassign: {
          devices: oldDevices.filter((id) => !nextDevices.includes(id)),
          policies: [...oldPolicies.keys()].filter((id) => !nextPolicies.has(id)),
        },
      });
    },
    onSuccess: async () => {
      setEdit(false);
      await invalidate();
    },
  }));

  const sync = useMutation(() => ({
    mutationFn: () => enterprise.syncGroups(params.tenantId, [params.groupId!]),
  }));

  const dup = useMutation(() => ({
    mutationFn: () => enterprise.duplicateGroup(params.tenantId, params.groupId),
    onSuccess: async ({ id }) => {
      await qc.invalidateQueries({ queryKey: enterpriseKeys.list(params.tenantId, "group") });
      navigate(`/t/${params.tenantId}/groups/${id}`);
    },
  }));

  const del = useMutation(() => ({
    mutationFn: () =>
      enterprise.deleteGroups(params.tenantId, params.groupId ? [params.groupId] : []),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: enterpriseKeys.list(params.tenantId, "group") });
      navigate(`/t/${params.tenantId}/groups`);
    },
  }));

  const toggle = (set: () => Set<string>, update: (v: Set<string>) => void, id: string) => {
    if (!edit()) return;
    const next = new Set(set());

    if (next.has(id)) next.delete(id);
    else next.add(id);
    update(next);
  };

  const setPolicyMode = (id: string, mode: "include" | "exclude" | "") => {
    if (!edit()) return;
    const next = new Map(policyModes());

    if (mode) next.set(id, mode);
    else next.delete(id);
    setPolicyModes(next);
  };

  const memberCount = () =>
    row()?.kind === "dynamic" ? (preview.data?.count ?? "…") : (row()?.devices?.length ?? 0);

  return (
    <Page wide>
      <QueryError error={group.error} onRetry={() => void group.refetch()} />

      <PageHeader
        title={row()?.name ?? "Group"}
        description={
          dirty() ? "Group has unsaved changes" : "Manage group metadata and assignments."
        }
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => (edit() ? (dirty() ? save.mutate() : setEdit(false)) : setEdit(true))}
            >
              {!edit() ? "Edit" : dirty() ? "Save" : "Done"}
            </Button>
            <Button variant="outline" onClick={() => sync.mutate()} disabled={sync.isPending}>
              {sync.isPending ? "Syncing…" : "Sync"}
            </Button>
            <Button variant="outline" onClick={() => dup.mutate()} disabled={dup.isPending}>
              Duplicate
            </Button>
            <Button
              variant="destructive"
              onClick={() => setDeleteOpen(true)}
              disabled={del.isPending}
            >
              Delete
            </Button>
          </>
        }
      />

      <ErrorText error={sync.error} />

      <div class="flex flex-col gap-2.5 rounded-lg border border-white/[0.07] bg-white/[0.02] px-3.5 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <Show when={row()}>
          <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Show when={row()!.kind === "dynamic"}>
              <Badge>Dynamic</Badge>
            </Show>
            <Show when={row()!.kind === "manual"}>
              <Badge variant="secondary">Manual</Badge>
            </Show>
            <span class="flex items-baseline gap-1.5">
              <span class="text-[15px] font-semibold tabular-nums leading-none text-foreground">
                {memberCount()}
              </span>
              <span class="text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
                devices
              </span>
            </span>
            <span class="flex items-baseline gap-1.5">
              <span class="text-[15px] font-semibold tabular-nums leading-none text-foreground">
                {row()!.policies?.length ?? 0}
              </span>
              <span class="text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
                policies
              </span>
            </span>
            <Show when={row()!.kind === "dynamic" && row()!.lastEvaluatedAt}>
              <span class="text-[11px] text-muted-foreground">
                Evaluated {formatDate(row()!.lastEvaluatedAt!)}
              </span>
            </Show>
          </div>
        </Show>
        <div class="inline-flex w-fit items-center gap-0.5 rounded-lg border border-white/[0.07] bg-white/[0.015] p-0.5">
          <For each={["overview", "devices", "policies"] as const}>
            {(item) => (
              <Button
                size="sm"
                variant={tab() === item ? "secondary" : "ghost"}
                class="h-7 rounded-md px-2.5 text-[12px] capitalize"
                onClick={() => setTab(item)}
              >
                {item}
              </Button>
            )}
          </For>
        </div>
      </div>

      <Show when={tab() === "overview"}>
        <div class="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <Panel
            title="Group details"
            description="Name, notes and the membership source for this target."
          >
            <form
              class="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                save.mutate();
              }}
            >
              <div class="grid gap-4 sm:grid-cols-2">
                <Field label="Name">
                  <Input
                    disabled={!edit()}
                    value={name()}
                    onInput={(e) => setName(e.currentTarget.value)}
                  />
                </Field>
                <Field label="Membership">
                  <select
                    disabled={!edit()}
                    class="h-8 rounded-lg px-2.5 pr-8 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-70"
                    value={kind()}
                    onChange={(e) => setKind(e.currentTarget.value as DynamicGroupKind)}
                  >
                    <option value="manual">Manual — choose devices</option>
                    <option value="dynamic">Dynamic — match device rules</option>
                  </select>
                </Field>
              </div>
              <Field label="Notes">
                <textarea
                  disabled={!edit()}
                  class="min-h-24 rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30 disabled:opacity-70"
                  value={notes()}
                  onInput={(e) => setNotes(e.currentTarget.value)}
                />
              </Field>
              <Show when={kind() === "dynamic"}>
                <div class="rounded-lg border border-white/[0.07] bg-white/[0.02] p-3">
                  <GroupRuleBuilder rules={rules()} onChange={setRules} disabled={!edit()} />
                </div>
              </Show>
              <ErrorText error={save.error || dup.error || del.error} />
            </form>
          </Panel>
          <Show
            when={kind() === "dynamic"}
            fallback={
              <Panel
                title="Assignments"
                description="Where this group's membership and policy scope live."
              >
                <dl class="divide-y divide-white/[0.05] text-[13px]">
                  <div class="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                    <div class="min-w-0">
                      <dt class="font-medium text-foreground">Devices</dt>
                      <dd class="mt-0.5 text-[12px] text-muted-foreground">
                        {row()?.devices?.length ?? 0} assigned manually
                      </dd>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => setTab("devices")}>
                      Manage
                    </Button>
                  </div>
                  <div class="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                    <div class="min-w-0">
                      <dt class="font-medium text-foreground">Policies</dt>
                      <dd class="mt-0.5 text-[12px] text-muted-foreground">
                        {row()?.policies?.length ?? 0} included or excluded
                      </dd>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => setTab("policies")}>
                      Manage
                    </Button>
                  </div>
                </dl>
              </Panel>
            }
          >
            <Panel
              title="Live match preview"
              description="Devices matching the saved rules. Manual members are not included unless they also match."
            >
              <div class="space-y-3">
                <p class="text-[26px] font-semibold leading-none tracking-[-0.03em] text-foreground">
                  {preview.data?.count ?? "…"}
                </p>
                <Show when={preview.data && preview.data.count === 0}>
                  <p class="text-[12px] text-muted-foreground">No devices match these rules yet.</p>
                </Show>
                <QueryError error={preview.error} onRetry={() => void preview.refetch()} />
                <Show when={(preview.data?.devices.length ?? 0) > 0}>
                  <div class="max-h-64 space-y-0.5 overflow-auto">
                    <For each={preview.data?.devices.slice(0, 25) ?? []}>
                      {(device) => (
                        <a
                          class="block truncate rounded-md px-2 py-1.5 text-[12.5px] text-foreground transition-colors hover:bg-white/[0.045]"
                          href={`/t/${params.tenantId}/devices/${device.id}`}
                        >
                          {device.name}
                        </a>
                      )}
                    </For>
                  </div>
                </Show>
                <Show when={(preview.data?.devices.length ?? 0) > 25}>
                  <p class="text-[11px] text-muted-foreground">
                    Showing the first 25 matches. Refresh after saving to recompute membership.
                  </p>
                </Show>
              </div>
            </Panel>
          </Show>
        </div>
      </Show>

      <Show when={tab() === "devices"}>
        <Show
          when={kind() !== "dynamic"}
          fallback={
            <div class="space-y-5">
              <div class="flex items-start gap-2.5 rounded-lg border border-white/[0.08] bg-white/[0.02] p-3.5 text-[12.5px] text-foreground">
                <Info class="mt-px size-4 shrink-0 text-muted-foreground" />
                <div class="min-w-0">
                  <p class="font-medium text-foreground">Dynamic membership</p>
                  <p class="mt-1 leading-relaxed text-muted-foreground">
                    Devices are added to this group automatically when they match the rules. Manual
                    device assignment is disabled; switch to a manual group to choose devices
                    explicitly. Manually added exceptions are preserved by recomputes but are not
                    listed here.
                  </p>
                </div>
              </div>
              <QueryError error={preview.error} onRetry={() => void preview.refetch()} />
              <Panel flush title="Matched devices" description="Current rule evaluation result.">
                <Show
                  when={(preview.data?.devices.length ?? 0) > 0}
                  fallback={
                    <div class="px-4 py-10 text-center sm:px-5">
                      <p class="text-[13px] font-medium text-foreground">
                        No devices match the current rules
                      </p>
                      <p class="mx-auto mt-1 max-w-sm text-[12px] text-muted-foreground">
                        Adjust the rule conditions in Overview, then save to re-evaluate membership.
                      </p>
                    </div>
                  }
                >
                  <div class="overflow-x-auto">
                    <table class="w-full text-[13px]">
                      <thead class="border-b border-white/[0.06] bg-white/[0.02] text-left text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                        <tr>
                          <th class="px-4 py-2.5">Matched device</th>
                          <th class="px-4 py-2.5">Source</th>
                        </tr>
                      </thead>
                      <tbody class="divide-y divide-white/[0.05]">
                        <For each={preview.data?.devices ?? []}>
                          {(device) => (
                            <tr class="transition-colors hover:bg-white/[0.025]">
                              <td class="px-4 py-2.5">
                                <a
                                  class="font-medium text-foreground hover:underline"
                                  href={`/t/${params.tenantId}/devices/${device.id}`}
                                >
                                  {device.name}
                                </a>
                              </td>
                              <td class="px-4 py-2.5 text-[12px] text-muted-foreground">
                                Rule match
                              </td>
                            </tr>
                          )}
                        </For>
                      </tbody>
                    </table>
                  </div>
                </Show>
              </Panel>
            </div>
          }
        >
          <div class="space-y-5">
            <QueryError
              error={groupDevices.error ?? allDevices.error}
              onRetry={() => {
                void groupDevices.refetch();
                void allDevices.refetch();
              }}
            />
            <Panel
              flush
              title="Devices in this group"
              description={
                edit()
                  ? "Tick a device to add it to this group, untick to remove it. Remember to save your changes."
                  : "Manual membership for this group. Use Edit to change the assigned devices."
              }
            >
              <AssignmentTable
                rows={deviceRows()}
                selected={deviceIds()}
                toggle={(id) => toggle(deviceIds, setDeviceIds, id)}
                href={(id) => `/t/${params.tenantId}/devices/${id}`}
                emptyTitle="No devices assigned"
                emptyDescription="Use Edit to choose from the tenant's enrolled devices and add them to this group."
              />
              <Show when={!edit() && deviceTotal() > deviceRows().length}>
                <p class="border-t border-white/[0.06] px-4 py-2.5 text-[11px] text-muted-foreground">
                  Showing the first {deviceRows().length} of {deviceTotal()} devices. Edit the group
                  to assign devices outside this list.
                </p>
              </Show>
            </Panel>
          </div>
        </Show>
      </Show>

      <Show when={tab() === "policies"}>
        <div class="space-y-5">
          <QueryError error={policies.error} onRetry={() => void policies.refetch()} />
          <div class="flex items-start gap-2.5 rounded-lg border border-white/[0.08] bg-white/[0.02] p-3.5 text-[12.5px] text-foreground">
            <Info class="mt-px size-4 shrink-0 text-muted-foreground" />
            <div class="min-w-0">
              <p class="font-medium text-foreground">Policy precedence</p>
              <p class="mt-1 leading-relaxed text-muted-foreground">
                Group includes deliver a policy to every member. A group exclude vetoes that policy
                for all groups; a direct device include can still override it. Highest policy
                priority wins when two included policies provide the same configuration kind.
              </p>
            </div>
          </div>
          <Panel
            flush
            title="Policy assignments"
            description="Include delivers the policy to members; exclude removes it for this group."
          >
            <Show when={!policies.isError}>
              <AssignmentTable
                rows={policies.data?.rows ?? []}
                selected={new Set(policyModes().keys())}
                toggle={(id) => setPolicyMode(id, policyModes().has(id) ? "" : "include")}
                mode={(id) => policyModes().get(id)}
                setMode={setPolicyMode}
                href={(id) => `/t/${params.tenantId}/policies/${id}`}
                emptyTitle="No policies yet"
                emptyDescription="Create a policy first, then return here to include or exclude it for this group's members."
                emptyIcon={ShieldCheck}
              />
            </Show>
          </Panel>
        </div>
      </Show>

      <Dialog open={deleteOpen()} onOpenChange={setDeleteOpen}>
        <DialogContent class="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete {row()?.name ?? "group"}?</DialogTitle>
          </DialogHeader>
          <p class="text-sm text-muted-foreground">
            Devices keep their other group memberships. Type{" "}
            <span class="font-mono font-medium">{row()?.name}</span> to confirm.
          </p>
          <Input value={deleteConfirm()} onInput={(e) => setDeleteConfirm(e.currentTarget.value)} />
          <ErrorText error={del.error} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteConfirm() !== row()?.name || del.isPending}
              onClick={() => del.mutate()}
            >
              Delete group
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Page>
  );
}

function AssignmentTable<T extends DeviceRow | PolicyRow>(props: {
  rows: readonly T[];
  selected: Set<string>;
  toggle: (id: string) => void;
  href: (id: string) => string;
  mode?: (id: string) => "include" | "exclude" | undefined;
  setMode?: (id: string, mode: "include" | "exclude" | "") => void;
  emptyTitle: string;
  emptyDescription: string;
  emptyIcon?: (props: { class?: string }) => JSX.Element;
}) {
  return (
    <Show
      when={props.rows.length > 0}
      fallback={
        <div class="px-4 py-10 text-center sm:px-5">
          <div class="mx-auto mb-3 flex size-9 items-center justify-center rounded-lg border border-white/[0.07] bg-white/[0.035] text-muted-foreground">
            <Show when={props.emptyIcon} fallback={<UsersRound class="size-4" />}>
              {(icon) => icon()({ class: "size-4" })}
            </Show>
          </div>
          <p class="text-[13px] font-medium text-foreground">{props.emptyTitle}</p>
          <p class="mx-auto mt-1 max-w-sm text-[12px] leading-relaxed text-muted-foreground">
            {props.emptyDescription}
          </p>
        </div>
      }
    >
      <div class="overflow-x-auto">
        <table class="w-full text-[13px]">
          <thead class="border-b border-white/[0.06] bg-white/[0.02] text-left text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
            <tr>
              <th class="w-10 px-4 py-2.5">In</th>
              <th class="px-4 py-2.5">Name</th>
              <Show when={props.mode}>
                <th class="w-40 px-4 py-2.5">Mode</th>
              </Show>
              <th class="px-4 py-2.5">Priority</th>
              <th class="px-4 py-2.5">Updated</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-white/[0.05]">
            <For each={props.rows}>
              {(row) => (
                <tr class="transition-colors hover:bg-white/[0.025]">
                  <td class="px-4 py-2.5">
                    <input
                      type="checkbox"
                      class="size-3.5 accent-[var(--brand)]"
                      aria-label={`Assign ${row.name}`}
                      checked={props.selected.has(row.id)}
                      onChange={() => props.toggle(row.id)}
                    />
                  </td>
                  <td class="px-4 py-2.5">
                    <a
                      class="font-medium text-foreground hover:underline"
                      href={props.href(row.id)}
                    >
                      {row.name}
                    </a>
                  </td>
                  <Show when={props.mode}>
                    <td class="px-4 py-2.5">
                      <select
                        class="h-7 rounded-md px-2 pr-7 text-[11.5px] disabled:opacity-50"
                        aria-label={`Assignment mode for ${row.name}`}
                        disabled={!props.selected.has(row.id)}
                        value={props.mode?.(row.id) ?? ""}
                        onChange={(event) =>
                          props.setMode?.(
                            row.id,
                            event.currentTarget.value as "include" | "exclude" | "",
                          )
                        }
                      >
                        <option value="">Not assigned</option>
                        <option value="include">Include</option>
                        <option value="exclude">Exclude</option>
                      </select>
                    </td>
                  </Show>
                  <td class="px-4 py-2.5 text-[12px] tabular-nums text-muted-foreground">
                    {"priority" in row ? (row.priority ?? 0) : "—"}
                  </td>
                  <td class="whitespace-nowrap px-4 py-2.5 text-[12px] text-muted-foreground">
                    {"updatedAt" in row
                      ? new Date(row.updatedAt).toLocaleString()
                      : new Date(row.lastSeenAt).toLocaleString()}
                  </td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </div>
    </Show>
  );
}
