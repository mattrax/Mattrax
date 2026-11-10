import { useNavigate, useParams } from "@solidjs/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { ErrorText, Field, PageHeader, QueryError } from "~/components/mdm/common";
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
  const [deviceIds, setDeviceIds] = createSignal<Set<string>>(new Set());
  const [policyIds, setPolicyIds] = createSignal<Set<string>>(new Set());
  createEffect(
    () => ({ row: row(), edit: edit() }),
    ({ row, edit }) => {
      if (row && !edit) {
        setName(row.name);
        setNotes(row.notes ?? "");
        setDeviceIds(new Set(row.devices?.map((d) => d.id) ?? []));
        setPolicyIds(new Set(row.policies?.map((p) => p.id) ?? []));
      }
    },
  );
  const dirty = createMemo(
    () =>
      row() &&
      (name() !== row()!.name ||
        notes() !== (row()!.notes ?? "") ||
        [...deviceIds()].sort().join(",") !==
          (row()!
            .devices?.map((d) => d.id)
            .sort()
            .join(",") ?? "") ||
        [...policyIds()].sort().join(",") !==
          (row()!
            .policies?.map((p) => p.id)
            .sort()
            .join(",") ?? "")),
  );
  const invalidate = async () => {
    await qc.invalidateQueries({
      queryKey: enterpriseKeys.item(params.tenantId, "group", params.groupId),
    });
    await qc.invalidateQueries({ queryKey: enterpriseKeys.list(params.tenantId, "group") });
  };
  const save = useMutation(() => ({
    mutationFn: async () => {
      const oldDevices = row()?.devices?.map((d) => d.id) ?? [];
      const oldPolicies = row()?.policies?.map((p) => p.id) ?? [];
      const nextDevices = [...deviceIds()];
      const nextPolicies = [...policyIds()];
      if (name() !== row()?.name || notes() !== (row()?.notes ?? ""))
        await enterprise.patchGroup(params.tenantId, params.groupId, {
          name: name(),
          notes: notes() || null,
        });
      await enterprise.patchGroupMembers(params.tenantId, params.groupId, {
        assign: {
          devices: nextDevices.filter((id) => !oldDevices.includes(id)),
          policies: nextPolicies.filter((id) => !oldPolicies.includes(id)),
        },
        unassign: {
          devices: oldDevices.filter((id) => !nextDevices.includes(id)),
          policies: oldPolicies.filter((id) => !nextPolicies.includes(id)),
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
        <div class="mr-4 flex gap-6 text-sm">
          <span>
            <span class="font-semibold text-stone-900">{row()?.devices?.length ?? 0}</span>
            <span class="text-muted-foreground"> devices</span>
          </span>
          <span>
            <span class="font-semibold text-stone-900">{row()?.policies?.length ?? 0}</span>
            <span class="text-muted-foreground"> policies</span>
          </span>
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
        <Card class="max-w-xl">
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
              <ErrorText error={save.error || dup.error || del.error} />
            </form>
          </CardContent>
        </Card>
      </Show>
      <Show when={tab() === "devices"}>
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
      <Show when={tab() === "policies"}>
        <AssignmentTable
          rows={policies.data?.rows ?? []}
          selected={policyIds()}
          toggle={(id) => toggle(policyIds, setPolicyIds, id)}
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
}) {
  return (
    <div class="overflow-hidden rounded-xl border bg-card">
      <table class="w-full text-sm">
        <thead class="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
          <tr>
            <th class="w-10 px-4 py-3">In</th>
            <th class="px-4 py-3">Name</th>
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
