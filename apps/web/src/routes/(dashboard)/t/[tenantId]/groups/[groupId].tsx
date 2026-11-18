import { useParams } from "@solidjs/router";
import { useNavigate } from "~/lib/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { GroupNode } from "@mattrax/enterprise-domain/client";
import { Option, Schema } from "effect";
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import {
  ErrorText,
  Field,
  Page,
  PageHeader,
  Panel,
  QueryError,
  formatDate,
  formatDeviceDate,
} from "~/components/mdm/common";
import { GroupRuleBuilder } from "~/components/mdm/group-rules";
import { MdmTable } from "~/components/mdm/table";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Info } from "~/components/ui/icons";
import { Input } from "~/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { toast } from "~/components/toast";
import {
  enterprise,
  enterpriseKeys,
  type DeviceRow,
  type DeviceSearchQuery,
  type DynamicGroupKind,
  type DynamicGroupRules,
  type PolicyRow,
} from "~/lib/enterprise";
import { errorMessage, raisedFailure } from "~/lib/errors";
import { useCan } from "~/lib/permissions";
import { useUnsavedChanges } from "~/lib/unsaved-changes";

const decodeGroupNode = Schema.decodeUnknownOption(GroupNode);

const decodeGroupKind = Schema.decodeUnknownOption(Schema.Literals(["manual", "dynamic"]));

const decodeAssignmentMode = Schema.decodeUnknownOption(Schema.Literals(["include", "exclude"]));

const GROUP_DEVICE_PAGE_SIZE = 50;

export default function GroupDetailPage() {
  const params = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { can } = useCan();
  const editable = () => can("groups.write");
  const [edit, setEdit] = createSignal(false);
  // Rules saved on an already-dynamic group are part of the page's entrance;
  // only a manual → dynamic switch animates the rule builder into view.
  const [revealRules, setRevealRules] = createSignal(false);

  const group = useQuery(() => ({
    queryKey: enterpriseKeys.item(params.tenantId, "group", params.groupId),
    queryFn: () => enterprise.get(params.tenantId, "group", params.groupId),
  }));

  // Membership is a server-paged device search in both modes: the view is
  // scoped to this group, while edit mode searches the whole tenant so
  // unassigned devices can be added.
  const [deviceSearch, setDeviceSearch] = createSignal("");
  const [deviceTerm, setDeviceTerm] = createSignal("");
  const [devicePage, setDevicePage] = createSignal(0);
  let deviceTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(deviceTimer));
  createEffect(
    () => deviceSearch(),
    (value) => {
      clearTimeout(deviceTimer);
      deviceTimer = setTimeout(() => {
        setDeviceTerm(value.trim());
        setDevicePage(0);
      }, 200);
    },
  );

  const deviceQuery = (): DeviceSearchQuery => {
    const base = {
      limit: GROUP_DEVICE_PAGE_SIZE,
      offset: devicePage() * GROUP_DEVICE_PAGE_SIZE,
      sort: "name" as const,
    };

    if (edit()) return deviceTerm() ? { ...base, q: deviceTerm() } : base;

    return deviceTerm()
      ? { ...base, groupId: params.groupId, q: deviceTerm() }
      : { ...base, groupId: params.groupId };
  };

  const groupDevices = useQuery(() => ({
    queryKey: enterpriseKeys.deviceSearch(params.tenantId, deviceQuery()),
    queryFn: () => enterprise.searchDevices(params.tenantId, deviceQuery()),
  }));

  // Changing between view and edit switches the underlying set; start at the
  // first page so the pager never points past the new result.
  createEffect(
    () => edit(),
    () => {
      setDevicePage(0);
    },
  );

  const policies = useQuery(() => ({
    queryKey: enterpriseKeys.list(params.tenantId, "policy"),
    queryFn: () => enterprise.list(params.tenantId, "policy"),
  }));

  const preview = useQuery(() => ({
    queryKey: [...enterpriseKeys.item(params.tenantId, "group", params.groupId), "preview"],
    queryFn: () => enterprise.previewGroup(params.tenantId, params.groupId),
  }));

  const row = () => Option.getOrUndefined(decodeGroupNode(group.data));

  // A read-only role never enters the edit state, even if it was opened before
  // a role change landed.
  createEffect(
    () => editable(),
    (writable) => {
      if (!writable) setEdit(false);
    },
  );

  // The full tenant list is only needed while editing, because the picker must
  // offer unassigned devices too.
  const deviceRows = () => groupDevices.data?.devices ?? [];
  const deviceTotal = () => groupDevices.data?.total ?? 0;
  const devicePageCount = () => Math.max(1, Math.ceil(deviceTotal() / GROUP_DEVICE_PAGE_SIZE));

  // A deletion (or a concurrent enrollment) can leave the pager past the end.
  createEffect(
    () => ({ total: deviceTotal(), page: devicePage() }),
    ({ total, page }) => {
      const last = Math.max(0, Math.ceil(total / GROUP_DEVICE_PAGE_SIZE) - 1);

      if (page > last) setDevicePage(last);
    },
  );

  const [deleteOpen, setDeleteOpen] = createSignal(false);
  const [deleteConfirm, setDeleteConfirm] = createSignal("");
  const [tab, setTab] = createSignal<"overview" | "devices" | "policies">("overview");
  const [name, setName] = createSignal("");
  const [notes, setNotes] = createSignal("");
  const [kind, setKind] = createSignal<DynamicGroupKind>("manual");
  const [rules, setRules] = createSignal<DynamicGroupRules>({ version: 1 });
  const [deviceIds, setDeviceIds] = createSignal<Set<string>>(new Set());
  const [policyModes, setPolicyModes] = createSignal<Map<string, "include" | "exclude">>(new Map());
  const [policySearch, setPolicySearch] = createSignal("");
  const [seeded, setSeeded] = createSignal(false);
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
        setSeeded(true);
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
      seeded() &&
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

  const unsaved = useUnsavedChanges(() => edit() && Boolean(dirty()), {
    title: "Discard group changes?",
    description: "This group has membership or metadata edits that have not been saved.",
  });

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
          policies: [...nextPolicies].flatMap(([id, mode]) =>
            oldPolicies.get(id) === mode ? [] : [{ id, mode }],
          ),
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
      toast.success("Group saved");
    },
    onError: (error) =>
      toast.error("Could not save the group", {
        description: errorMessage(raisedFailure(error), "Try again in a moment."),
      }),
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

  const setPolicyMode = (id: string, mode: "include" | "exclude" | "") => {
    if (!edit()) return;
    const next = new Map(policyModes());

    if (mode) next.set(id, mode);
    else next.delete(id);
    setPolicyModes(next);
  };

  /** MdmTable's checkbox column mirrors the include set, not a bulk selection. */
  const setDeviceSelection = (ids: ReadonlySet<string>) => {
    if (!edit()) return;
    setDeviceIds(new Set(ids));
  };

  const setPolicySelection = (ids: ReadonlySet<string>) => {
    if (!edit()) return;
    const next = new Map(policyModes());

    for (const id of ids) if (!next.has(id)) next.set(id, "include");

    for (const id of next.keys()) if (!ids.has(id)) next.delete(id);
    setPolicyModes(next);
  };

  const addAllShownDevices = () => {
    if (!edit()) return;
    const next = new Set(deviceIds());

    for (const device of deviceRows()) next.add(device.id);
    setDeviceIds(next);
  };

  const shownPolicies = () => {
    const term = policySearch().trim().toLowerCase();

    if (!term) return policies.data?.rows ?? [];

    return (policies.data?.rows ?? []).filter(
      (policy) =>
        policy.name.toLowerCase().includes(term) ||
        (policy.notes ?? "").toLowerCase().includes(term),
    );
  };

  const addAllShownPolicies = () => {
    if (!edit()) return;
    const next = new Map(policyModes());

    for (const policy of shownPolicies()) next.set(policy.id, "include");
    setPolicyModes(next);
  };

  const memberCount = () =>
    row()?.kind === "dynamic" ? (preview.data?.count ?? "…") : (row()?.devices?.length ?? 0);

  return (
    <Page wide>
      {unsaved.prompt}
      <QueryError error={group.error} onRetry={() => void group.refetch()} />

      <PageHeader
        title={row()?.name ?? "Group"}
        description={
          dirty() ? "Group has unsaved changes" : "Manage group metadata and assignments."
        }
        actions={
          <Show when={editable()}>
            <>
              <Button
                variant="outline"
                onClick={() =>
                  edit() ? (dirty() ? save.mutate() : setEdit(false)) : setEdit(true)
                }
              >
                {!edit() ? "Edit" : dirty() ? "Save" : "Done"}
              </Button>
              <Show when={row()?.kind === "dynamic"}>
                <Button variant="outline" onClick={() => sync.mutate()} disabled={sync.isPending}>
                  {sync.isPending ? "Syncing…" : "Sync"}
                </Button>
              </Show>
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
          </Show>
        }
      />

      <ErrorText error={sync.error} />

      <div class="flex flex-col gap-2.5 rounded-lg border border-border bg-surface px-3.5 py-2.5 sm:flex-row sm:items-center sm:justify-between">
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
        <div class="inline-flex w-fit items-center gap-0.5 rounded-lg border border-border bg-surface p-0.5">
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
                    onChange={(e) => {
                      const value = Option.getOrUndefined(decodeGroupKind(e.currentTarget.value));

                      if (value !== undefined) {
                        if (value === "dynamic" && kind() !== "dynamic") setRevealRules(true);
                        setKind(value);
                      }
                    }}
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
                <div
                  class={`rounded-lg border border-border bg-surface p-3 ${
                    revealRules()
                      ? "animate-in motion-reduce:animate-none fade-in-0 slide-in-from-top-1 duration-[var(--duration-popover)] ease-swift"
                      : ""
                  }`}
                >
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
                <div class="divide-y divide-border text-[13px]">
                  <div class="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                    <div class="min-w-0">
                      <p class="font-medium text-foreground">Devices</p>
                      <p class="mt-0.5 text-[12px] text-muted-foreground">
                        {row()?.devices?.length ?? 0} assigned manually
                      </p>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => setTab("devices")}>
                      Manage
                    </Button>
                  </div>
                  <div class="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                    <div class="min-w-0">
                      <p class="font-medium text-foreground">Policies</p>
                      <p class="mt-0.5 text-[12px] text-muted-foreground">
                        {row()?.policies?.length ?? 0} included or excluded
                      </p>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => setTab("policies")}>
                      Manage
                    </Button>
                  </div>
                </div>
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
                          class="block truncate rounded-md px-2 py-1.5 text-[12.5px] text-foreground transition-colors duration-[var(--duration-hover)] ease-swift hover:bg-hover"
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
              <div class="flex items-start gap-2.5 rounded-lg border border-border bg-surface p-3.5 text-[12.5px] text-foreground">
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
                      <thead class="border-b border-border bg-surface text-left text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                        <tr>
                          <th class="px-4 py-2.5">Matched device</th>
                          <th class="px-4 py-2.5">Source</th>
                        </tr>
                      </thead>
                      <tbody class="divide-y divide-border">
                        <For each={preview.data?.devices ?? []}>
                          {(device) => (
                            <tr class="transition-colors duration-[var(--duration-hover)] ease-swift hover:bg-hover">
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
            <Panel
              flush
              title="Devices in this group"
              description={
                edit()
                  ? "Tick a device to add it to this group, untick to remove it. Remember to save your changes."
                  : "Manual membership for this group. Use Edit to change the assigned devices."
              }
            >
              <div class="p-3">
                <MdmTable<DeviceRow>
                  mode="server"
                  rows={deviceRows()}
                  selectable={editable() && edit()}
                  selectedIds={deviceIds}
                  onSelectedChange={setDeviceSelection}
                  loading={groupDevices.isPending}
                  isFetching={groupDevices.isFetching}
                  onRefresh={() => void groupDevices.refetch()}
                  error={groupDevices.error}
                  total={deviceTotal()}
                  caption="Devices in this group"
                  storageKey="group-devices"
                  rowHref={(device) => `/t/${params.tenantId}/devices/${device.id}`}
                  searchValue={deviceSearch()}
                  onSearchChange={setDeviceSearch}
                  searchPlaceholder="Search name, serial, asset tag…"
                  toolbar={
                    <Show when={edit()}>
                      <div class="flex flex-wrap items-center justify-between gap-2">
                        <p class="text-[11.5px] text-muted-foreground">
                          {deviceIds().size} device{deviceIds().size === 1 ? "" : "s"} selected in
                          this group.
                        </p>
                        <Button
                          size="xs"
                          variant="outline"
                          disabled={deviceRows().length === 0}
                          onClick={addAllShownDevices}
                        >
                          Add all shown ({deviceRows().length})
                        </Button>
                      </div>
                    </Show>
                  }
                  footer={
                    <div class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface px-3.5 py-2.5">
                      <span class="text-[12px] tabular-nums text-muted-foreground">
                        Page {devicePage() + 1} of {devicePageCount()}
                        <Show when={deviceTotal() > 0}>
                          {" "}
                          · {deviceTotal().toLocaleString()} device
                          {deviceTotal() === 1 ? "" : "s"}
                        </Show>
                        <Show when={deviceTerm()}> · filtered by “{deviceTerm()}”</Show>
                      </span>
                      <div class="flex items-center gap-1.5">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={devicePage() === 0}
                          onClick={() => setDevicePage((value) => Math.max(0, value - 1))}
                        >
                          Previous
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={(devicePage() + 1) * GROUP_DEVICE_PAGE_SIZE >= deviceTotal()}
                          onClick={() => setDevicePage((value) => value + 1)}
                        >
                          Next
                        </Button>
                      </div>
                    </div>
                  }
                  empty={
                    <div class="flex min-h-40 flex-col items-center justify-center px-4 py-8 text-center">
                      <p class="text-[13px] font-medium text-foreground">
                        {deviceTerm()
                          ? `No devices match “${deviceTerm()}”`
                          : edit()
                            ? "No devices enrolled yet"
                            : "No devices assigned"}
                      </p>
                      <p class="mx-auto mt-1 max-w-sm text-[12px] leading-relaxed text-muted-foreground">
                        {deviceTerm()
                          ? "Search matches the device name, serial number and asset tag."
                          : edit()
                            ? "Enroll a device, then return here to add it to this group."
                            : "Use Edit to choose from the tenant's enrolled devices and add them to this group."}
                      </p>
                    </div>
                  }
                  columns={[
                    {
                      id: "name",
                      header: "Name",
                      search: (device) => device.name,
                      cell: (device) => (
                        <a
                          class="font-medium text-foreground hover:underline"
                          href={`/t/${params.tenantId}/devices/${device.id}`}
                        >
                          {device.name}
                        </a>
                      ),
                    },
                    {
                      id: "serial",
                      header: "Serial",
                      search: (device) => device.serial,
                      cell: (device) => device.serial ?? "Unknown",
                    },
                    {
                      id: "assetTag",
                      header: "Asset tag",
                      search: (device) => device.assetTag,
                      cell: (device) => device.assetTag ?? "—",
                    },
                    {
                      id: "lastSeen",
                      header: "Last seen",
                      cell: (device) => formatDeviceDate(device.lastSeenAt),
                    },
                  ]}
                />
              </div>
            </Panel>
          </div>
        </Show>
      </Show>

      <Show when={tab() === "policies"}>
        <div class="space-y-5">
          <div class="flex items-start gap-2.5 rounded-lg border border-border bg-surface p-3.5 text-[12.5px] text-foreground">
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
            <div class="p-3">
              <MdmTable<PolicyRow>
                rows={policies.data?.rows ?? []}
                selectable={editable() && edit()}
                selectedIds={() => new Set(policyModes().keys())}
                onSelectedChange={setPolicySelection}
                loading={policies.isPending}
                isFetching={policies.isFetching}
                onRefresh={() => void policies.refetch()}
                error={policies.error}
                caption="Policy assignments"
                storageKey="group-policies"
                rowHref={(policy) => `/t/${params.tenantId}/policies/${policy.id}`}
                searchValue={policySearch()}
                onSearchChange={setPolicySearch}
                searchPlaceholder="Search policies by name or notes…"
                toolbar={
                  <Show when={edit()}>
                    <div class="flex flex-wrap items-center justify-between gap-2">
                      <p class="text-[11.5px] text-muted-foreground">
                        {policyModes().size} polic{policyModes().size === 1 ? "y" : "ies"} assigned.
                      </p>
                      <Button
                        size="xs"
                        variant="outline"
                        disabled={shownPolicies().length === 0}
                        onClick={addAllShownPolicies}
                      >
                        Include all shown ({shownPolicies().length})
                      </Button>
                    </div>
                  </Show>
                }
                empty={
                  <div class="flex min-h-40 flex-col items-center justify-center px-4 py-8 text-center">
                    <p class="text-[13px] font-medium text-foreground">No policies yet</p>
                    <p class="mx-auto mt-1 max-w-sm text-[12px] leading-relaxed text-muted-foreground">
                      Create a policy first, then return here to include or exclude it for this
                      group's members.
                    </p>
                  </div>
                }
                columns={[
                  {
                    id: "name",
                    header: "Name",
                    search: (policy) => policy.name,
                    cell: (policy) => (
                      <a
                        class="font-medium text-foreground hover:underline"
                        href={`/t/${params.tenantId}/policies/${policy.id}`}
                      >
                        {policy.name}
                      </a>
                    ),
                  },
                  {
                    id: "mode",
                    header: "Mode",
                    cell: (policy) => (
                      <select
                        class="h-7 rounded-md px-2 pr-7 text-[11.5px] disabled:opacity-50"
                        aria-label={`Assignment mode for ${policy.name}`}
                        disabled={!edit() || !editable()}
                        value={policyModes().get(policy.id) ?? ""}
                        onChange={(event) =>
                          setPolicyMode(
                            policy.id,
                            Option.getOrUndefined(
                              decodeAssignmentMode(event.currentTarget.value),
                            ) ?? "",
                          )
                        }
                      >
                        <option value="" selected={!policyModes().get(policy.id)}>
                          Not assigned
                        </option>
                        <option
                          value="include"
                          selected={policyModes().get(policy.id) === "include"}
                        >
                          Include
                        </option>
                        <option
                          value="exclude"
                          selected={policyModes().get(policy.id) === "exclude"}
                        >
                          Exclude
                        </option>
                      </select>
                    ),
                  },
                  {
                    id: "priority",
                    header: "Priority",
                    cell: (policy) => (
                      <span class="text-[12px] tabular-nums text-muted-foreground">
                        {policy.priority ?? 0}
                      </span>
                    ),
                  },
                  {
                    id: "updated",
                    header: "Updated",
                    cell: (policy) => (
                      <span class="whitespace-nowrap text-[12px] text-muted-foreground">
                        {new Date(policy.updatedAt).toLocaleString()}
                      </span>
                    ),
                  },
                ]}
              />
            </div>
          </Panel>
        </div>
      </Show>

      <Dialog
        open={deleteOpen()}
        onOpenChange={(open) => {
          if (!open) setDeleteConfirm("");
          setDeleteOpen(open);
        }}
      >
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
