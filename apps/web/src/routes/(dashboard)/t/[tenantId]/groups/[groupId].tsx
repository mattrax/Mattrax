import { useNavigate, useParams } from "@solidjs/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { ErrorText, Field, PageHeader, QueryError, formatDate } from "~/components/mdm/common";
import { GroupRuleBuilder } from "~/components/mdm/group-rules";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
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
  return (
    <div class="flex flex-1 flex-col gap-6 p-6">
      <QueryError error={group.error} onRetry={() => void group.refetch()} />

      <ErrorText error={sync.error} />
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
      <div class="flex flex-wrap items-center gap-2">
        <Show when={row()?.kind === "dynamic"}>
          <Badge>Dynamic</Badge>
        </Show>
        <div class="mr-4 flex gap-6 text-sm">
          <span>
            <span class="font-semibold text-stone-900">
              {row()?.kind === "dynamic"
                ? (preview.data?.count ?? "…")
                : (row()?.devices?.length ?? 0)}
            </span>
            <span class="text-muted-foreground"> devices</span>
          </span>
          <span>
            <span class="font-semibold text-stone-900">{row()?.policies?.length ?? 0}</span>
            <span class="text-muted-foreground"> policies</span>
          </span>
          <Show when={row()?.kind === "dynamic" && row()?.lastEvaluatedAt}>
            <span class="text-muted-foreground">
              Evaluated {formatDate(row()!.lastEvaluatedAt!)}
            </span>
          </Show>
        </div>
        <For each={["overview", "devices", "policies"] as const}>
          {(item) => (
            <Button variant={tab() === item ? "secondary" : "ghost"} onClick={() => setTab(item)}>
              {item}
            </Button>
          )}
        </For>
      </div>
      <Show when={tab() === "overview"}>
        <div class="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <Card>
            <CardHeader>
              <CardTitle>Overview</CardTitle>
            </CardHeader>
            <CardContent>
              <form
                class="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  save.mutate();
                }}
              >
                <Field label="Name">
                  <Input
                    disabled={!edit()}
                    value={name()}
                    onInput={(e) => setName(e.currentTarget.value)}
                  />
                </Field>
                <Field label="Notes">
                  <textarea
                    disabled={!edit()}
                    class="min-h-28 rounded-lg border bg-white px-3 py-2 text-sm disabled:opacity-70"
                    value={notes()}
                    onInput={(e) => setNotes(e.currentTarget.value)}
                  />
                </Field>
                <Field label="Membership">
                  <select
                    disabled={!edit()}
                    class="h-9 rounded-lg border bg-white px-3 text-sm disabled:opacity-70"
                    value={kind()}
                    onChange={(e) => setKind(e.currentTarget.value as DynamicGroupKind)}
                  >
                    <option value="manual">Manual — choose devices</option>
                    <option value="dynamic">Dynamic — match device rules</option>
                  </select>
                </Field>
                <Show when={kind() === "dynamic"}>
                  <div class="rounded-lg border bg-muted/20 p-3">
                    <GroupRuleBuilder rules={rules()} onChange={setRules} disabled={!edit()} />
                  </div>
                </Show>
                <ErrorText error={save.error || dup.error || del.error} />
              </form>
            </CardContent>
          </Card>
          <Show when={kind() === "dynamic"}>
            <Card>
              <CardHeader>
                <CardTitle>Live match preview</CardTitle>
              </CardHeader>
              <CardContent class="space-y-3">
                <p class="text-3xl font-semibold">{preview.data?.count ?? "…"}</p>
                <p class="text-sm text-muted-foreground">
                  Devices matching the saved rules. Manual members are not included unless they also
                  match.
                </p>
                <QueryError error={preview.error} onRetry={() => void preview.refetch()} />
                <Show when={(preview.data?.devices.length ?? 0) > 0}>
                  <div class="max-h-64 space-y-1 overflow-auto text-sm">
                    <For each={preview.data?.devices.slice(0, 25) ?? []}>
                      {(device) => (
                        <a
                          class="block truncate rounded px-2 py-1 hover:bg-muted/40"
                          href={`/t/${params.tenantId}/devices/${device.id}`}
                        >
                          {device.name}
                        </a>
                      )}
                    </For>
                  </div>
                </Show>
                <Show when={(preview.data?.devices.length ?? 0) > 25}>
                  <p class="text-xs text-muted-foreground">
                    Showing the first 25 matches. Refresh after saving to recompute membership.
                  </p>
                </Show>
              </CardContent>
            </Card>
          </Show>
        </div>
      </Show>
      <Show when={tab() === "devices"}>
        <Show
          when={kind() !== "dynamic"}
          fallback={
            <>
              <div class="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">
                <p class="font-medium">Dynamic membership</p>
                <p class="mt-1">
                  Devices are added to this group automatically when they match the rules. Manual
                  device assignment is disabled; switch to a manual group to choose devices
                  explicitly. Manually added exceptions are preserved by recomputes but are not
                  listed here.
                </p>
              </div>
              <QueryError error={preview.error} onRetry={() => void preview.refetch()} />
              <div class="overflow-hidden rounded-xl border bg-card">
                <table class="w-full text-sm">
                  <thead class="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                    <tr>
                      <th class="px-4 py-3">Matched device</th>
                      <th class="px-4 py-3">Source</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y">
                    <Show
                      when={(preview.data?.devices.length ?? 0) > 0}
                      fallback={
                        <tr>
                          <td class="px-4 py-3 text-muted-foreground" colspan={2}>
                            No devices match the current rules.
                          </td>
                        </tr>
                      }
                    >
                      <For each={preview.data?.devices ?? []}>
                        {(device) => (
                          <tr class="hover:bg-muted/25">
                            <td class="px-4 py-3">
                              <a
                                class="font-medium hover:underline"
                                href={`/t/${params.tenantId}/devices/${device.id}`}
                              >
                                {device.name}
                              </a>
                            </td>
                            <td class="px-4 py-3 text-muted-foreground">Rule match</td>
                          </tr>
                        )}
                      </For>
                    </Show>
                  </tbody>
                </table>
              </div>
            </>
          }
        >
          <QueryError
            error={groupDevices.error ?? allDevices.error}
            onRetry={() => {
              void groupDevices.refetch();
              void allDevices.refetch();
            }}
          />
          <AssignmentTable
            rows={deviceRows()}
            selected={deviceIds()}
            toggle={(id) => toggle(deviceIds, setDeviceIds, id)}
            href={(id) => `/t/${params.tenantId}/devices/${id}`}
          />
          <Show when={!edit() && deviceTotal() > deviceRows().length}>
            <p class="text-sm text-muted-foreground">
              Showing the first {deviceRows().length} of {deviceTotal()} devices. Edit the group to
              assign devices outside this list.
            </p>
          </Show>
        </Show>
      </Show>
      <Show when={tab() === "policies"}>
        <div class="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">
          <p class="font-medium">Policy precedence</p>
          <p class="mt-1">
            Group includes deliver a policy to every member. A group exclude vetoes that policy for
            all groups; a direct device include can still override it. Highest policy priority wins
            when two included policies provide the same configuration kind.
          </p>
        </div>
        <AssignmentTable
          rows={policies.data?.rows ?? []}
          selected={new Set(policyModes().keys())}
          toggle={(id) => setPolicyMode(id, policyModes().has(id) ? "" : "include")}
          mode={(id) => policyModes().get(id)}
          setMode={setPolicyMode}
          href={(id) => `/t/${params.tenantId}/policies/${id}`}
        />
      </Show>

      <Dialog open={deleteOpen()} onOpenChange={setDeleteOpen}>
        <DialogContent class="max-w-md rounded-xl bg-white p-6">
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
    </div>
  );
}

function AssignmentTable<T extends DeviceRow | PolicyRow>(props: {
  rows: readonly T[];
  selected: Set<string>;
  toggle: (id: string) => void;
  href: (id: string) => string;
  mode?: (id: string) => "include" | "exclude" | undefined;
  setMode?: (id: string, mode: "include" | "exclude" | "") => void;
}) {
  return (
    <div class="overflow-hidden rounded-xl border bg-card">
      <table class="w-full text-sm">
        <thead class="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
          <tr>
            <th class="w-10 px-4 py-3">In</th>
            <th class="px-4 py-3">Name</th>
            <Show when={props.mode}>
              <th class="w-40 px-4 py-3">Mode</th>
            </Show>
            <th class="px-4 py-3">Priority</th>
            <th class="px-4 py-3">Updated</th>
          </tr>
        </thead>
        <tbody class="divide-y">
          <For each={props.rows}>
            {(row) => (
              <tr class="hover:bg-muted/25">
                <td class="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={props.selected.has(row.id)}
                    onChange={() => props.toggle(row.id)}
                  />
                </td>
                <td class="px-4 py-3">
                  <a class="font-medium hover:underline" href={props.href(row.id)}>
                    {row.name}
                  </a>
                </td>
                <Show when={props.mode}>
                  <td class="px-4 py-3">
                    <select
                      class="rounded border bg-white px-2 py-1 text-xs disabled:opacity-50"
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
                <td class="px-4 py-3">{"priority" in row ? (row.priority ?? 0) : "—"}</td>
                <td class="px-4 py-3">
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
  );
}
