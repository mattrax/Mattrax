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
import { StaleWriteBanner } from "~/components/stale-write-banner";
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
import { enterprise, enterpriseKeys } from "~/lib/enterprise";
import type {
  DeviceRow,
  DeviceSearchQuery,
  DynamicGroupKind,
  DynamicGroupRules,
  PolicyRow,
} from "~/lib/enterprise";
import { errorMessage, raisedFailure } from "~/lib/errors";
import { createStaleWriteGuard } from "~/lib/stale-write";
import { handleStaleWriteWithToast } from "~/lib/stale-write-toast";
import {
  optimisticallyPatchItem,
  optimisticallyRemoveRows,
  optimisticallyUpdateList,
} from "~/lib/optimistic";
import { isPolicyEnabled, policyStatePresentation } from "~/lib/policy-delivery";
import {
  groupScopeBlockedDeviceIds,
  groupScopePolicyIsInert,
  groupScopeWinningDeviceIds,
  policyScopeReasonLabel,
  policyScopeStatusLabel,
  policyScopeStatusTone,
} from "~/lib/policy-scope";
import { useCan } from "~/lib/permissions";
import { ScopeTagAssignmentEditor } from "~/components/scope-tags/scope-tag-select";
import { useUnsavedChanges } from "~/lib/unsaved-changes";
import { preloadPage } from "~/lib/page-data";
import { queryClient } from "~/lib/query-client";
import { enterpriseQueries } from "~/lib/enterprise";

const decodeGroupNode = Schema.decodeUnknownOption(GroupNode);

const decodeAssignmentMode = Schema.decodeUnknownOption(Schema.Literals(["include", "exclude"]));

const GROUP_DEVICE_PAGE_SIZE = 50;

export const route = {
  preload: ({
    params,
    intent,
  }: {
    params: { tenantId?: string; groupId?: string };
    intent: string;
  }) => {
    const tenantId = params.tenantId;
    const groupId = params.groupId;

    if (intent === "initial" || !tenantId || !groupId) return;

    return preloadPage([
      () => queryClient.ensureQueryData(enterpriseQueries.item(tenantId, "group", groupId)),
      () => queryClient.ensureQueryData(enterpriseQueries.list(tenantId, "policy")),
      () => queryClient.ensureQueryData(enterpriseQueries.directory(tenantId)),
      () =>
        queryClient.ensureQueryData({
          queryKey: [...enterpriseKeys.item(tenantId, "group", groupId), "preview"],
          queryFn: () => enterprise.previewGroup(tenantId, groupId),
        }),
    ]);
  },
};

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

  // Only needed while editing, to offer child groups that are not already
  // nested here. The list is tenant-scoped by the API.
  const allGroups = useQuery(() => ({
    queryKey: enterpriseKeys.list(params.tenantId, "group"),
    queryFn: () => enterprise.list(params.tenantId, "group"),
  }));

  const directory = useQuery(() => enterpriseQueries.directory(params.tenantId));

  const preview = useQuery(() => ({
    queryKey: [...enterpriseKeys.item(params.tenantId, "group", params.groupId), "preview"],
    queryFn: () => enterprise.previewGroup(params.tenantId, params.groupId),
  }));

  const scope = useQuery(() => enterpriseQueries.groupScope(params.tenantId, params.groupId));

  const row = () => Option.getOrUndefined(decodeGroupNode(group.data));
  const guard = createStaleWriteGuard(() => row()?.updatedAt);

  /** Begin editing against the version currently shown. */
  const startEdit = () => {
    guard.acceptLatest();
    setEdit(true);
  };

  /** Discard the draft for the version the server has now. */
  const reloadLatest = async () => {
    await group.refetch();
    guard.acceptLatest();
    setEdit(false);
  };

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
  const [directoryGroupId, setDirectoryGroupId] = createSignal<string | null>(null);
  const [rules, setRules] = createSignal<DynamicGroupRules>({ version: 1 });
  const [deviceIds, setDeviceIds] = createSignal<Set<string>>(new Set());
  const [policyModes, setPolicyModes] = createSignal<Map<string, "include" | "exclude">>(new Map());
  const [policySearch, setPolicySearch] = createSignal("");
  const [seeded, setSeeded] = createSignal(false);
  // Nested groups and exclusions are saved through the same members endpoint.
  const [childGroupIds, setChildGroupIds] = createSignal<Set<string>>(new Set());
  const [excludedDeviceIds, setExcludedDeviceIds] = createSignal<Set<string>>(new Set());
  const [excludedUserIds, setExcludedUserIds] = createSignal<Set<string>>(new Set());
  const [childGroupChoice, setChildGroupChoice] = createSignal("");
  const [excludeDeviceChoice, setExcludeDeviceChoice] = createSignal("");
  const [excludeUserChoice, setExcludeUserChoice] = createSignal("");

  /** Only explicit manual rows are the editable selection; derived rows are not. */
  const savedManualDeviceIds = () =>
    new Set(
      (row()?.devices ?? [])
        .filter((device) => (device.source ?? "manual") === "manual")
        .map((device) => device.id),
    );

  const savedChildGroupIds = () => new Set((row()?.childGroups ?? []).map((group) => group.id));

  const savedExcludedDeviceIds = () =>
    new Set(
      (row()?.exclusions ?? []).filter((item) => item.kind === "device").map((item) => item.id),
    );

  const savedExcludedUserIds = () =>
    new Set(
      (row()?.exclusions ?? []).filter((item) => item.kind === "user").map((item) => item.id),
    );

  createEffect(
    () => ({ row: row(), edit: edit() }),
    ({ row, edit }) => {
      if (row && !edit) {
        setName(row.name);
        setNotes(row.notes ?? "");
        setKind(row.kind ?? "manual");
        setDirectoryGroupId(row.directoryGroupId ?? null);
        setRules(row.rules ?? { version: 1 });
        setDeviceIds(savedManualDeviceIds());
        setChildGroupIds(savedChildGroupIds());
        setExcludedDeviceIds(savedExcludedDeviceIds());
        setExcludedUserIds(savedExcludedUserIds());
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

  const membershipMode = () => (directoryGroupId() ? "directory" : kind());

  /**
   * A mode switch changes which rows the server keeps. Re-seed the editable
   * selection so stale manual ticks are not shown as if they survived.
   */
  const resetDeviceSelection = (next: "manual" | "dynamic" | "directory") => {
    setDeviceIds(next === "manual" ? savedManualDeviceIds() : new Set<string>());
  };

  const directoryChanged = () => (directoryGroupId() ?? null) !== (row()?.directoryGroupId ?? null);

  const rulesChanged = () =>
    JSON.stringify(rules()) !== JSON.stringify(row()?.rules ?? { version: 1 });

  const sameIds = (left: Iterable<string>, right: Iterable<string>) =>
    [...left].sort().join("\u0000") === [...right].sort().join("\u0000");

  const dirty = createMemo(
    () =>
      seeded() &&
      row() &&
      (name() !== row()!.name ||
        notes() !== (row()!.notes ?? "") ||
        kindChanged() ||
        directoryChanged() ||
        rulesChanged() ||
        (membershipMode() === "manual" && !sameIds(deviceIds(), savedManualDeviceIds())) ||
        !sameIds(childGroupIds(), savedChildGroupIds()) ||
        !sameIds(excludedDeviceIds(), savedExcludedDeviceIds()) ||
        !sameIds(excludedUserIds(), savedExcludedUserIds()) ||
        currentPolicySignature() !== policySignature(row()!.policies ?? [])),
  );

  const unsaved = useUnsavedChanges(() => edit() && Boolean(dirty()), {
    title: "Discard group changes?",
    description: "This group has membership or metadata edits that have not been saved.",
  });

  const invalidate = async () => {
    await Promise.all([
      qc.invalidateQueries({
        queryKey: enterpriseKeys.item(params.tenantId, "group", params.groupId),
      }),
      qc.invalidateQueries({ queryKey: enterpriseKeys.list(params.tenantId, "group") }),
      qc.invalidateQueries({
        queryKey: [...enterpriseKeys.item(params.tenantId, "group", params.groupId), "preview"],
      }),
      qc.invalidateQueries({
        queryKey: enterpriseKeys.groupScope(params.tenantId, params.groupId),
      }),
    ]);
  };

  /** Patch the group header and its list row in one snapshot. */
  const patchGroup = async (patch: Partial<GroupNode>) => {
    const restores = await Promise.all([
      optimisticallyPatchItem(qc, params.tenantId!, "group", params.groupId!, patch),
      optimisticallyUpdateList(qc, params.tenantId!, "group", (rows) =>
        rows.map((row) => (row.id === params.groupId ? { ...row, ...patch } : row)),
      ),
    ]);

    return () => restores.forEach((restore) => restore());
  };

  const save = useMutation(() => ({
    meta: { inlineError: true },
    mutationFn: async () => {
      // Derived rows (dynamic, directory, nested) are not manual membership and
      // must never be sent as an unassign.
      const oldDevices = [...savedManualDeviceIds()];

      const oldPolicies = new Map(
        (row()?.policies ?? []).map((policy) => [policy.id, policy.mode ?? "include"]),
      );

      const oldChildGroups = [...savedChildGroupIds()];
      const oldExcludedDevices = [...savedExcludedDeviceIds()];
      const oldExcludedUsers = [...savedExcludedUserIds()];

      const nextDevices = membershipMode() === "manual" ? [...deviceIds()] : oldDevices;
      const nextPolicies = policyModes();
      const nextChildGroups = [...childGroupIds()];
      const nextExcludedDevices = [...excludedDeviceIds()];
      const nextExcludedUsers = [...excludedUserIds()];

      if (
        name() !== row()?.name ||
        notes() !== (row()?.notes ?? "") ||
        kindChanged() ||
        directoryChanged() ||
        rulesChanged()
      )
        await enterprise.patchGroup(params.tenantId, params.groupId, {
          name: name(),
          notes: notes() || null,
          kind: kind(),
          rules: kind() === "dynamic" ? rules() : null,
          directoryGroupId: directoryGroupId(),
          expectedUpdatedAt: guard.expectedUpdatedAt(),
        });
      await enterprise.patchGroupMembers(params.tenantId, params.groupId, {
        assign: {
          devices: nextDevices.filter((id) => !oldDevices.includes(id)),
          policies: [...nextPolicies].flatMap(([id, mode]) =>
            oldPolicies.get(id) === mode ? [] : [{ id, mode }],
          ),
          childGroups: nextChildGroups.filter((id) => !oldChildGroups.includes(id)),
        },
        unassign: {
          devices: oldDevices.filter((id) => !nextDevices.includes(id)),
          policies: [...oldPolicies.keys()].filter((id) => !nextPolicies.has(id)),
          childGroups: oldChildGroups.filter((id) => !nextChildGroups.includes(id)),
        },
        exclude: {
          devices: nextExcludedDevices.filter((id) => !oldExcludedDevices.includes(id)),
          users: nextExcludedUsers.filter((id) => !oldExcludedUsers.includes(id)),
        },
        unexclude: {
          devices: oldExcludedDevices.filter((id) => !nextExcludedDevices.includes(id)),
          users: oldExcludedUsers.filter((id) => !nextExcludedUsers.includes(id)),
        },
      });
    },
    onMutate: async () => {
      const nextDevices = membershipMode() === "manual" ? deviceIds() : undefined;

      const nextPolicies = policyModes();

      const linkedDirectory = directoryGroupId()
        ? (directory.data?.groups.find((group) => group.id === directoryGroupId()) ?? null)
        : null;

      const restore = await patchGroup({
        name: name(),
        notes: notes() || null,
        kind: kind(),
        rules: kind() === "dynamic" ? rules() : null,
        directoryGroupId: directoryGroupId(),
        directoryGroup: linkedDirectory
          ? { id: linkedDirectory.id, name: linkedDirectory.name }
          : null,
        ...(nextDevices
          ? {
              devicesCount: nextDevices.size,
              policiesCount: nextPolicies.size,
            }
          : { policiesCount: nextPolicies.size }),
      });

      // Stay in edit mode until the save succeeds: leaving it on submit lets
      // a refetch reseed the form and discard membership edits on failure.
      return { restore };
    },
    onSuccess: () => {
      guard.markSaved();
      setEdit(false);
      toast.success("Group saved");
      void invalidate();
    },
    onError: (error, _payload, context) => {
      context?.restore();

      if (handleStaleWriteWithToast(error, { reload: invalidate })) {
        // Stay in edit mode with every draft value intact. The banner offers
        // a reload or an explicit overwrite.
        guard.markConflict();
        setEdit(true);

        return;
      }

      toast.error("Could not save the group", {
        description: errorMessage(raisedFailure(error), "Try again in a moment."),
      });
    },
  }));

  const sync = useMutation(() => ({
    mutationFn: () => enterprise.syncGroups(params.tenantId, [params.groupId!]),
    onSuccess: () => {
      toast.success("Group sync requested");
      void invalidate();
    },
    onError: (error) =>
      toast.error("Could not request a group sync", {
        description: errorMessage(raisedFailure(error), "Try again in a moment."),
      }),
  }));

  const dup = useMutation(() => ({
    mutationFn: () => enterprise.duplicateGroup(params.tenantId, params.groupId),
    onSuccess: ({ id }) => {
      navigate(`/t/${params.tenantId}/groups/${id}`);
      void qc.invalidateQueries({ queryKey: enterpriseKeys.list(params.tenantId, "group") });
    },
  }));

  const del = useMutation(() => ({
    mutationFn: () =>
      enterprise.deleteGroups(params.tenantId, params.groupId ? [params.groupId] : []),
    onMutate: async () => {
      const restore = await optimisticallyRemoveRows(
        qc,
        params.tenantId!,
        "group",
        params.groupId ? [params.groupId] : [],
      );

      navigate(`/t/${params.tenantId}/groups`);

      return { restore };
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: enterpriseKeys.list(params.tenantId, "group") });
    },
    onError: (error, _payload, context) => {
      context?.restore();
      toast.error("Could not delete the group", {
        description: errorMessage(raisedFailure(error), "Try again in a moment."),
      });
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
    // Exclusions win over manual membership, so an excluded device cannot be
    // ticked as a member; the server would reject the write.
    setDeviceIds(new Set([...ids].filter((id) => !excludedDeviceIds().has(id))));
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

    for (const device of deviceRows()) if (!excludedDeviceIds().has(device.id)) next.add(device.id);
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

  /** Child groups that are not this group and not already nested here. */
  const childGroupChoices = () =>
    (allGroups.data?.rows ?? []).filter(
      (group) => group.id !== params.groupId && !childGroupIds().has(group.id),
    );

  const addChildGroup = () => {
    if (!edit()) return;
    const value = childGroupChoice();

    if (!value) return;
    setChildGroupIds(new Set([...childGroupIds(), value]));
    setChildGroupChoice("");
  };

  const removeChildGroup = (id: string) => {
    if (!edit()) return;
    const next = new Set(childGroupIds());

    next.delete(id);
    setChildGroupIds(next);
  };

  /**
   * Any device on the current page that is not already excluded. Members are
   * included: excluding a current member is the common case, and choosing it
   * clears the pending membership tick.
   */
  const excludeDeviceChoices = () =>
    deviceRows().filter((device) => !excludedDeviceIds().has(device.id));

  const excludeUserChoices = () =>
    (directory.data?.users ?? []).filter((user) => !excludedUserIds().has(user.id));

  const addExcludedDevice = () => {
    if (!edit()) return;
    const value = excludeDeviceChoice();

    if (!value) return;
    // An exclusion always wins: drop it from the pending membership as well.
    const members = new Set(deviceIds());

    members.delete(value);
    setDeviceIds(members);
    setExcludedDeviceIds(new Set([...excludedDeviceIds(), value]));
    setExcludeDeviceChoice("");
  };

  const addExcludedUser = () => {
    if (!edit()) return;
    const value = excludeUserChoice();

    if (!value) return;
    setExcludedUserIds(new Set([...excludedUserIds(), value]));
    setExcludeUserChoice("");
  };

  const removeExcludedDevice = (id: string) => {
    if (!edit()) return;
    const next = new Set(excludedDeviceIds());

    next.delete(id);
    setExcludedDeviceIds(next);
  };

  const removeExcludedUser = (id: string) => {
    if (!edit()) return;
    const next = new Set(excludedUserIds());

    next.delete(id);
    setExcludedUserIds(next);
  };

  /** Membership source per device for the table's Source column. */
  const membershipByDevice = () =>
    new Map((row()?.devices ?? []).map((device) => [device.id, device]));

  // The materialised membership is authoritative: it includes inherited
  // devices, which the live rule preview deliberately does not.
  const memberCount = () =>
    row()?.devices?.length ?? (row()?.kind === "dynamic" ? (preview.data?.count ?? "…") : 0);

  return (
    <Page wide>
      {unsaved.prompt}
      <QueryError error={group.error} onRetry={() => void group.refetch()} />

      <Show when={guard.conflict()}>
        <StaleWriteBanner
          reloading={group.isFetching}
          onReload={() => void reloadLatest()}
          onKeepMine={() => guard.acceptLatest()}
        />
      </Show>

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
                disabled={save.isPending}
                onClick={() => (edit() ? (dirty() ? save.mutate() : setEdit(false)) : startEdit())}
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
            <Show when={row()!.directoryGroupId}>
              <Badge>Directory</Badge>
            </Show>
            <Show when={row()!.kind === "manual" && !row()!.directoryGroupId}>
              <Badge variant="secondary">Manual</Badge>
            </Show>
            <Show when={(row()!.childGroups?.length ?? 0) > 0}>
              <Badge variant="outline">
                {row()!.childGroups!.length} nested group
                {row()!.childGroups!.length === 1 ? "" : "s"}
              </Badge>
            </Show>
            <Show when={(row()!.exclusions?.length ?? 0) > 0}>
              <Badge variant="subtle">
                {row()!.exclusions!.length} exclusion
                {row()!.exclusions!.length === 1 ? "" : "s"}
              </Badge>
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
                Evaluated {formatDate(row()!.lastEvaluatedAt)}
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
                    value={membershipMode()}
                    onChange={(e) => {
                      const value = Option.getOrUndefined(
                        Schema.decodeUnknownOption(
                          Schema.Literals(["manual", "dynamic", "directory"]),
                        )(e.currentTarget.value),
                      );

                      if (value === "dynamic") {
                        setDirectoryGroupId(null);
                        resetDeviceSelection("dynamic");

                        if (kind() !== "dynamic") setRevealRules(true);
                        setKind("dynamic");
                      } else if (value === "directory") {
                        setKind("manual");
                        resetDeviceSelection("directory");

                        setDirectoryGroupId(
                          directoryGroupId() ?? (directory.data?.groups ?? [])[0]?.id ?? "",
                        );
                      } else if (value === "manual") {
                        setDirectoryGroupId(null);
                        resetDeviceSelection("manual");
                        setKind("manual");
                      }
                    }}
                  >
                    <option value="manual">Manual — choose devices</option>
                    <option value="dynamic">Dynamic — match device rules</option>
                    <option value="directory">
                      Linked directory group — follow IdP membership
                    </option>
                  </select>
                </Field>
              </div>
              <Show when={membershipMode() === "directory"}>
                <Field
                  label="Directory group"
                  hint="Membership follows the group's active people and their linked devices."
                >
                  <select
                    disabled={!edit()}
                    class="h-8 rounded-lg px-2.5 pr-8 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-70"
                    value={directoryGroupId() ?? ""}
                    onChange={(e) => setDirectoryGroupId(e.currentTarget.value || null)}
                  >
                    <option value="">Choose a directory group</option>
                    <For each={directory.data?.groups ?? []}>
                      {(group) => (
                        <option value={group.id}>
                          {group.name} ({group.memberCount} member
                          {group.memberCount === 1 ? "" : "s"})
                        </option>
                      )}
                    </For>
                  </select>
                </Field>
                <p class="rounded-lg border border-border bg-surface px-3 py-2 text-[11.5px] leading-relaxed text-muted-foreground">
                  Device membership is read-only: each active member contributes the devices linked
                  to them. Recomputes run after directory sync, a device-user change, or an explicit
                  group sync. Policies and applications assigned to this group apply as usual.
                  Linking replaces any manual membership this group had; unlinking leaves it empty.
                </p>
              </Show>
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
                  <GroupRuleBuilder
                    rules={rules()}
                    onChange={setRules}
                    disabled={!edit()}
                    groups={allGroups.data?.rows ?? []}
                    groupId={params.groupId}
                  />
                </div>
              </Show>
              <ErrorText error={save.error || dup.error || del.error} />
            </form>
          </Panel>
          <Panel
            title="Scope tags"
            description="Limit which delegated administrators can see and change this group."
          >
            <ScopeTagAssignmentEditor
              tenantId={params.tenantId!}
              resourceType="group"
              resourceIds={[params.groupId!]}
            />
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
                        {membershipMode() === "directory"
                          ? `${row()?.devices?.length ?? 0} derived from directory membership`
                          : `${row()?.devices?.length ?? 0} assigned manually`}
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
                <Show when={preview.data?.problem}>
                  {(problem) => (
                    <div class="rounded-lg border border-border bg-surface px-3 py-2 text-[11.5px] leading-relaxed text-muted-foreground">
                      <p class="font-medium text-foreground">This group is not being evaluated</p>
                      <p class="mt-0.5">{problem()}</p>
                      <p class="mt-1">
                        Existing members are kept unchanged. Break the reference loop, or remove the
                        missing group, then save.
                      </p>
                    </div>
                  )}
                </Show>
                <Show when={(preview.data?.references?.length ?? 0) > 0}>
                  <div class="space-y-1">
                    <p class="text-[11px] font-medium text-muted-foreground">Referenced groups</p>
                    <For each={preview.data?.references ?? []}>
                      {(reference) => (
                        <div class="flex items-start justify-between gap-3 rounded-md border border-border bg-surface px-2.5 py-1.5">
                          <div class="min-w-0">
                            <a
                              class="block truncate text-[12px] text-foreground hover:underline"
                              href={`/t/${params.tenantId}/groups/${reference.id}`}
                            >
                              {reference.name}
                            </a>
                            <Show when={reference.problem}>
                              {(problem) => (
                                <p class="mt-0.5 text-[10.5px] leading-snug text-muted-foreground">
                                  {problem()}
                                </p>
                              )}
                            </Show>
                          </div>
                          <span class="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                            {reference.count} {reference.count === 1 ? "device" : "devices"}
                          </span>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
                <Show when={preview.data && preview.data.count === 0 && !preview.data.problem}>
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

          <Panel
            title="Nested groups"
            description="Every device in a child group is also a member here. Membership is a transitive union; a device is never counted twice."
            actions={
              <Show when={(row()?.childGroups?.length ?? 0) > 0}>
                <Badge variant="outline" class="tabular-nums text-muted-foreground">
                  {row()!.childGroups!.length}
                </Badge>
              </Show>
            }
          >
            <div class="space-y-3">
              <Show
                when={(row()?.childGroups?.length ?? 0) > 0}
                fallback={
                  <p class="text-[12px] text-muted-foreground">
                    This group has no child groups. Nesting a group includes all of its members,
                    including members it inherits from its own children.
                  </p>
                }
              >
                <div class="divide-y divide-border/60">
                  <For each={row()?.childGroups ?? []}>
                    {(child) => (
                      <div class="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
                        <span class="flex min-w-0 items-center gap-2">
                          <a
                            class="truncate text-[12.5px] font-medium text-foreground hover:underline"
                            href={`/t/${params.tenantId}/groups/${child.id}`}
                          >
                            {child.name}
                          </a>
                          <Badge variant="subtle">{child.kind ?? "manual"}</Badge>
                        </span>
                        <span class="flex shrink-0 items-center gap-2 text-[11px] tabular-nums text-muted-foreground">
                          {child.devicesCount ?? 0} device
                          {(child.devicesCount ?? 0) === 1 ? "" : "s"}
                          <Show when={edit()}>
                            <Button
                              size="xs"
                              variant="ghost"
                              onClick={() => removeChildGroup(child.id)}
                            >
                              Remove
                            </Button>
                          </Show>
                        </span>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
              <Show when={edit()}>
                <div class="flex flex-wrap items-center gap-2">
                  <select
                    class="h-8 min-w-0 flex-1 rounded-lg px-2.5 pr-8 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/30"
                    value={childGroupChoice()}
                    aria-label="Add a child group"
                    onChange={(event) => setChildGroupChoice(event.currentTarget.value)}
                  >
                    <option value="">Choose a group to nest…</option>
                    <For each={childGroupChoices()}>
                      {(group) => <option value={group.id}>{group.name}</option>}
                    </For>
                  </select>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!childGroupChoice()}
                    onClick={addChildGroup}
                  >
                    Add child group
                  </Button>
                </div>
                <p class="text-[11px] text-muted-foreground">
                  A group cannot contain itself, directly or through another group, and chains are
                  limited to eight levels. Removing a child immediately removes the devices only it
                  contributed.
                </p>
              </Show>
            </div>
          </Panel>

          <Panel
            class="xl:col-span-2"
            title="Computed scope"
            description="Policies this group carries and the member devices each one actually wins on."
            actions={
              <Show when={scope.data}>
                {(data) => (
                  <Badge variant="outline" class="tabular-nums text-muted-foreground">
                    {data().memberCount} member device{data().memberCount === 1 ? "" : "s"}
                  </Badge>
                )}
              </Show>
            }
          >
            <Show
              when={scope.data}
              fallback={
                <Show
                  when={scope.isError}
                  fallback={<p class="text-[12px] text-muted-foreground">Loading scope…</p>}
                >
                  <QueryError error={scope.error} onRetry={() => void scope.refetch()} />
                </Show>
              }
            >
              {(data) => (
                <div class="space-y-3">
                  <Show
                    when={data().policies.length > 0}
                    fallback={
                      <p class="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-5 text-[12.5px] text-muted-foreground">
                        This group carries no policies. Assign one from the Policies tab to see what
                        its membership receives.
                      </p>
                    }
                  >
                    <div class="space-y-3">
                      <For each={data().policies}>
                        {(policy) => {
                          const winning = () => groupScopeWinningDeviceIds(policy);
                          const blocked = () => groupScopeBlockedDeviceIds(policy);

                          return (
                            <div class="overflow-hidden rounded-lg border border-border">
                              <div class="flex flex-wrap items-center justify-between gap-2 bg-muted/20 px-3 py-2.5">
                                <a
                                  class="min-w-0 truncate text-[13px] font-medium text-foreground hover:underline"
                                  href={`/t/${params.tenantId}/policies/${policy.policyId}`}
                                >
                                  {policy.policyName}
                                </a>
                                <span class="flex flex-wrap items-center gap-1.5">
                                  <Badge
                                    variant={policy.mode === "exclude" ? "subtle" : "secondary"}
                                  >
                                    {policy.mode === "exclude" ? "Excluded" : "Included"}
                                  </Badge>
                                  <Show
                                    when={policy.mode !== "exclude"}
                                    fallback={
                                      <Badge variant="subtle" class="tabular-nums">
                                        Blocks {blocked().length} of {data().memberCount}
                                      </Badge>
                                    }
                                  >
                                    <Badge
                                      variant={
                                        groupScopePolicyIsInert(policy) ? "warning" : "success"
                                      }
                                      class="tabular-nums"
                                    >
                                      Wins on {winning().length} of {data().memberCount}
                                    </Badge>
                                  </Show>
                                </span>
                              </div>
                              <Show
                                when={policy.devices.length > 0}
                                fallback={
                                  <p class="px-3 py-2.5 text-[12px] text-muted-foreground">
                                    No member device is in this policy's assignment graph.
                                  </p>
                                }
                              >
                                <div class="divide-y divide-border/60">
                                  <For each={policy.devices.slice(0, 8)}>
                                    {(entry) => (
                                      <div class="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-[12px]">
                                        <span class="flex min-w-0 items-center gap-2">
                                          <a
                                            class="truncate font-medium text-foreground hover:underline"
                                            href={`/t/${params.tenantId}/devices/${entry.deviceId}`}
                                          >
                                            {entry.deviceName}
                                          </a>
                                          <Show when={entry.channel === "user"}>
                                            <span class="truncate text-[11px] text-muted-foreground">
                                              ({entry.userName})
                                            </span>
                                          </Show>
                                        </span>
                                        <span class="flex min-w-0 flex-wrap items-center justify-end gap-2">
                                          <span class="truncate text-[11px] text-muted-foreground">
                                            {policyScopeReasonLabel(entry)}
                                          </span>
                                          <Badge variant={policyScopeStatusTone(entry)}>
                                            {policyScopeStatusLabel(entry)}
                                          </Badge>
                                        </span>
                                      </div>
                                    )}
                                  </For>
                                </div>
                                <Show when={policy.devices.length > 8}>
                                  <p class="border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
                                    +{policy.devices.length - 8} more entries. Open the policy's
                                    Scope panel for the full list.
                                  </p>
                                </Show>
                              </Show>
                            </div>
                          );
                        }}
                      </For>
                    </div>
                  </Show>
                  <Show when={data().truncated}>
                    <p class="text-[11px] text-muted-foreground">
                      The member list is capped. Open a policy's Scope panel for its bounded device
                      list.
                    </p>
                  </Show>
                </div>
              )}
            </Show>
          </Panel>
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
              <Show when={(row()?.childGroups?.length ?? 0) > 0}>
                <Panel
                  flush
                  title="Inherited devices"
                  description="Members inherited from child groups. They receive this group's policies but stay in the child group."
                >
                  <Show
                    when={(row()?.devices ?? []).some((device) => device.source === "nested")}
                    fallback={
                      <p class="px-4 py-6 text-[12px] text-muted-foreground">
                        The child groups have no members yet.
                      </p>
                    }
                  >
                    <div class="divide-y divide-border">
                      <For
                        each={(row()?.devices ?? []).filter((device) => device.source === "nested")}
                      >
                        {(device) => (
                          <div class="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                            <a
                              class="font-medium text-foreground hover:underline"
                              href={`/t/${params.tenantId}/devices/${device.id}`}
                            >
                              {device.name}
                            </a>
                            <span class="text-[11.5px] text-muted-foreground">
                              via{" "}
                              {(device.inheritedFrom ?? []).map((group) => group.name).join(", ")}
                            </span>
                          </div>
                        )}
                      </For>
                    </div>
                  </Show>
                </Panel>
              </Show>
            </div>
          }
        >
          <div class="space-y-5">
            <Panel
              flush
              title="Devices in this group"
              description={
                membershipMode() === "directory"
                  ? "Derived from the linked directory group. Link devices to directory users on each device to change membership."
                  : edit()
                    ? "Tick a device to add it to this group, untick to remove it. Remember to save your changes."
                    : "Manual membership for this group. Use Edit to change the assigned devices."
              }
            >
              <div class="p-3">
                <MdmTable<DeviceRow>
                  mode="server"
                  rows={deviceRows()}
                  selectable={membershipMode() === "manual" && editable() && edit()}
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
                    <Show when={membershipMode() === "manual" && edit()}>
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
                      id: "source",
                      header: "Membership",
                      cell: (device) => {
                        const membership = membershipByDevice().get(device.id);
                        const source = membership?.source ?? "manual";

                        if (source === "nested")
                          return (
                            <span class="inline-flex min-w-0 items-center gap-1.5 text-[12px] text-muted-foreground">
                              <Badge variant="subtle">Inherited</Badge>
                              <span class="truncate">
                                {(membership?.inheritedFrom ?? [])
                                  .map((group) => group.name)
                                  .join(", ") || "child group"}
                              </span>
                            </span>
                          );

                        return (
                          <span class="text-[12px] capitalize text-muted-foreground">{source}</span>
                        );
                      },
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

        <Panel
          class="mt-5"
          title="Exclusions"
          description="Explicit exclusions always win over manual membership, rule matches and inherited membership."
        >
          <div class="space-y-4">
            <div>
              <p class="mb-2 text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
                Excluded devices
              </p>
              <Show
                when={(row()?.exclusions ?? []).some((item) => item.kind === "device")}
                fallback={<p class="text-[12px] text-muted-foreground">No devices are excluded.</p>}
              >
                <div class="divide-y divide-border/60">
                  <For each={(row()?.exclusions ?? []).filter((item) => item.kind === "device")}>
                    {(exclusion) => (
                      <div class="flex items-center justify-between gap-3 py-2 first:pt-0">
                        <a
                          class="min-w-0 truncate text-[12.5px] font-medium text-foreground hover:underline"
                          href={`/t/${params.tenantId}/devices/${exclusion.id}`}
                        >
                          {exclusion.name}
                        </a>
                        <Show when={edit()}>
                          <Button
                            size="xs"
                            variant="ghost"
                            onClick={() => removeExcludedDevice(exclusion.id)}
                          >
                            Remove
                          </Button>
                        </Show>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
              <Show when={edit()}>
                <div class="mt-2 flex flex-wrap items-center gap-2">
                  <select
                    class="h-8 min-w-0 flex-1 rounded-lg px-2.5 pr-8 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/30"
                    value={excludeDeviceChoice()}
                    aria-label="Exclude a device"
                    onChange={(event) => setExcludeDeviceChoice(event.currentTarget.value)}
                  >
                    <option value="">Choose a device on this page to exclude…</option>
                    <For each={excludeDeviceChoices()}>
                      {(device) => <option value={device.id}>{device.name}</option>}
                    </For>
                  </select>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!excludeDeviceChoice()}
                    onClick={addExcludedDevice}
                  >
                    Exclude device
                  </Button>
                </div>
              </Show>
              <p class="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                Excluding a device removes every way it is a member of this group, including
                inherited membership. Its other groups and direct policy assignments still apply.
              </p>
            </div>

            <div class="border-t border-border pt-4">
              <p class="mb-2 text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
                Excluded people
              </p>
              <Show
                when={(row()?.exclusions ?? []).some((item) => item.kind === "user")}
                fallback={<p class="text-[12px] text-muted-foreground">No people are excluded.</p>}
              >
                <div class="divide-y divide-border/60">
                  <For each={(row()?.exclusions ?? []).filter((item) => item.kind === "user")}>
                    {(exclusion) => (
                      <div class="flex items-center justify-between gap-3 py-2 first:pt-0">
                        <span class="min-w-0">
                          <span class="block truncate text-[12.5px] font-medium text-foreground">
                            {exclusion.name}
                          </span>
                          <Show when={exclusion.email}>
                            <span class="block truncate text-[11px] text-muted-foreground">
                              {exclusion.email}
                            </span>
                          </Show>
                        </span>
                        <Show when={edit()}>
                          <Button
                            size="xs"
                            variant="ghost"
                            onClick={() => removeExcludedUser(exclusion.id)}
                          >
                            Remove
                          </Button>
                        </Show>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
              <Show when={edit()}>
                <div class="mt-2 flex flex-wrap items-center gap-2">
                  <select
                    class="h-8 min-w-0 flex-1 rounded-lg px-2.5 pr-8 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/30"
                    value={excludeUserChoice()}
                    aria-label="Exclude a directory user"
                    onChange={(event) => setExcludeUserChoice(event.currentTarget.value)}
                  >
                    <option value="">Choose a directory person to exclude…</option>
                    <For each={excludeUserChoices()}>
                      {(user) => (
                        <option value={user.id}>
                          {user.name} ({user.email})
                        </option>
                      )}
                    </For>
                  </select>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!excludeUserChoice()}
                    onClick={addExcludedUser}
                  >
                    Exclude person
                  </Button>
                </div>
              </Show>
              <p class="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                Excluding a person stops this group's user-scoped settings from reaching their Apple
                user channel and, when this group follows a directory group, stops their devices
                being added through that membership. A device that is also a member through another
                person, a rule, a manual assignment or a child group stays in the group and keeps
                device-scoped policy — remove the device explicitly to take it out entirely.
              </p>
            </div>
          </div>
        </Panel>
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
                      <span class="inline-flex min-w-0 items-center gap-1.5">
                        <a
                          class="min-w-0 truncate font-medium text-foreground hover:underline"
                          href={`/t/${params.tenantId}/policies/${policy.id}`}
                        >
                          {policy.name}
                        </a>
                        <Show when={!isPolicyEnabled(policy)}>
                          <Badge
                            variant={policyStatePresentation(policy).tone}
                            dot="warning"
                            title={policyStatePresentation(policy).description}
                          >
                            Disabled
                          </Badge>
                        </Show>
                      </span>
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
