import { useNavigate, useParams } from "@solidjs/router";
import {
  type InfiniteData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/solid-query";
import {
  DeviceRow,
  EffectivePolicyResponse,
  type DeviceActivityResponse,
} from "@mattrax/enterprise-domain/client";
import { Match, Option, Schema } from "effect";
import { createEffect, createMemo, createSignal, Errored, For, Show } from "solid-js";
import { isServer } from "@solidjs/web";
import type { JSX } from "@solidjs/web";
import {
  DeviceHealthBadge,
  DeviceStatusBadge,
  ErrorText,
  Field,
  formatDate,
  Page,
  PageBreadcrumbs,
  PageSkeleton,
  Panel,
  PlatformBadge,
  QueryError,
  SkeletonRows,
} from "~/components/mdm/common";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "~/components/ui/sheet";
import {
  RefreshCw,
  Laptop,
  MonitorSmartphone,
  Settings as SettingsIcon,
  Smartphone,
} from "~/components/ui/icons";
import {
  enterprise,
  enterpriseKeys,
  enterpriseQueries,
  type DeviceApplication,
} from "~/lib/enterprise";
import { Markdown } from "~/components/dashboard/markdown";
import {
  commandStatusTone,
  isActiveCommandStatus,
  mergeActivityPages,
} from "~/lib/device-activity";
import {
  policyDeliveryLabel,
  policyDeliveryState,
  type PolicyDeliveryState,
} from "~/lib/device-scope";
import {
  appleDeviceArtworkUrl,
  appleWarrantyUrl,
  DEVICE_ARTWORK_WIDTH,
} from "~/lib/device-artwork";
import { errorMessage, raisedFailure } from "~/lib/errors";
import { toast } from "~/components/toast";
import { ReadOnlyNotice, useCan } from "~/lib/permissions";
import { useUnsavedChanges } from "~/lib/unsaved-changes";

type ChipTone = "success" | "warning" | "danger" | "brand" | "muted";

type GroupMembership = { id: string; name: string };

const ACTIVITY_PAGE_SIZE = 50;

/** The command endpoint returns the newest 200 rows; page them on the client. */
const COMMAND_FETCH_LIMIT = 200;
const COMMAND_PAGE_SIZE = 20;

const decodeDeviceRow = Schema.decodeUnknownOption(DeviceRow);

const decodeEffectivePolicy = Schema.decodeUnknownOption(EffectivePolicyResponse);

const decodeJson = Schema.decodeUnknownOption(Schema.Json);

const isString = Schema.is(Schema.String);

const chipTones: Record<ChipTone, string> = {
  success: "border-success/25 bg-success/10 text-success-foreground",
  warning: "border-warning/25 bg-warning/10 text-warning-foreground",
  danger: "border-destructive/25 bg-destructive/10 text-destructive",
  brand: "border-brand/25 bg-brand/10 text-brand",
  muted: "border-border bg-surface text-muted-foreground",
};

const selectClass =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 pr-8 text-[12.5px] text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30 disabled:opacity-60";

function Chip(props: { tone?: ChipTone; class?: string; children: JSX.Element }) {
  return (
    <span
      class={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${
        chipTones[props.tone ?? "muted"]
      } ${props.class ?? ""}`}
    >
      {props.children}
    </span>
  );
}

/** A stacked label/value row used across the detail panels. */
function MetaRow(props: { label: string; children: JSX.Element }) {
  return (
    <div class="flex items-start justify-between gap-4 border-b border-border py-2 last:border-0">
      <dt class="shrink-0 text-[12px] text-muted-foreground">{props.label}</dt>
      <dd class="min-w-0 break-words text-right text-[12.5px] text-foreground">{props.children}</dd>
    </div>
  );
}

function DeviceGlyph(props: { proto: string; class?: string }) {
  return (
    <Show
      when={props.proto === "apple"}
      fallback={
        <Show when={props.proto === "win"} fallback={<Smartphone class={props.class} />}>
          <MonitorSmartphone class={props.class} />
        </Show>
      }
    >
      <Laptop class={props.class} />
    </Show>
  );
}

/**
 * The legacy device render, with the current platform glyph underneath while
 * the image loads (or permanently when there is no Apple artwork).
 */
function DeviceArtwork(props: { proto: string; modelIdentifier?: string | null; class?: string }) {
  const [loaded, setLoaded] = createSignal(false);
  const [failed, setFailed] = createSignal(false);
  const url = () => appleDeviceArtworkUrl(props.proto, props.modelIdentifier);

  createEffect(
    () => url(),
    () => {
      setLoaded(false);
      setFailed(false);
    },
  );

  return (
    <div
      class={`relative flex size-28 shrink-0 items-center justify-center sm:size-40 ${
        props.class ?? ""
      }`}
      aria-hidden="true"
    >
      <span
        class={`absolute inset-0 flex items-center justify-center text-muted-foreground transition-opacity duration-200 ease-swift ${
          loaded() ? "opacity-0" : "opacity-100"
        }`}
      >
        <DeviceGlyph proto={props.proto} class="size-9 sm:size-12" />
      </span>
      <Show when={failed() ? undefined : url()}>
        {(src) => (
          <img
            src={src()}
            alt=""
            width={DEVICE_ARTWORK_WIDTH}
            height={Math.round((DEVICE_ARTWORK_WIDTH * 1032) / 1688)}
            loading="lazy"
            decoding="async"
            class={`absolute inset-0 size-full object-contain transition-opacity duration-200 ease-swift ${
              loaded() ? "opacity-100" : "opacity-0"
            }`}
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
          />
        )}
      </Show>
    </div>
  );
}

function AbmPanel(props: {
  tenantId: string | undefined;
  serial: string | undefined;
  writable: boolean;
  assignAbm: any;
  adeProfile: any;
  adeUrl: () => string | null;
}) {
  const abmConfig = useQuery(() => enterpriseQueries.abm(props.tenantId));

  // A tenant without an ABM credential has no inventory to look a serial up in;
  // skipping the request keeps the console free of expected 404s.
  const abmDevice = useQuery(() => ({
    ...enterpriseQueries.abmDevice(props.tenantId, props.serial),
    enabled: Boolean(props.serial) && abmConfig.data?.configured === true,
  }));

  return (
    <Panel
      title="Apple Business Manager"
      description="Automated Device Enrollment state for this serial."
    >
      <div class="space-y-3 text-[12.5px]">
        <Show
          when={abmDevice.data}
          fallback={
            <Show
              when={abmDevice.isError}
              fallback={
                <p class="text-muted-foreground">
                  {abmConfig.data?.configured === false
                    ? "Apple Business Manager is not connected for this tenant."
                    : "This serial is not in the tenant's Apple Business Manager inventory."}{" "}
                  <a
                    class="font-medium text-foreground underline underline-offset-2"
                    href={`/t/${props.tenantId}/settings/management`}
                  >
                    Open Apple Business Manager settings
                  </a>
                  .
                </p>
              }
            >
              <QueryError error={abmDevice.error} onRetry={() => void abmDevice.refetch()} />
            </Show>
          }
        >
          {(abm) => (
            <>
              <div class="flex flex-wrap items-center gap-2">
                <Chip tone="muted" class="capitalize">
                  {abm().enrollmentState.toLowerCase()}
                </Chip>
                <Chip tone="muted" class="capitalize">
                  profile {abm().profileStatus}
                </Chip>
                <Show when={abm().deviceFamily}>
                  <span class="text-[11px] text-muted-foreground">{abm().deviceFamily}</span>
                </Show>
                <Show when={abm().os}>
                  <span class="text-[11px] text-muted-foreground">{abm().os}</span>
                </Show>
              </div>
              <Show when={abm().assignedProfileUuid}>
                <p class="break-all font-mono text-[11px] text-muted-foreground">
                  ADE profile {abm().assignedProfileUuid}
                </p>
              </Show>
              <Show when={abm().assignedServerId}>
                <p class="break-all font-mono text-[11px] text-muted-foreground">
                  MDM server {abm().assignedServerId}
                </p>
              </Show>
              <p class="text-[11px] text-muted-foreground">
                Last ABM update {formatDate(abm().lastSeenAt)}
              </p>
              <div class="flex flex-wrap gap-2">
                <Show when={abm().enrollmentState !== "ASSIGNED" && props.writable}>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={props.assignAbm.isPending}
                    onClick={() => props.assignAbm.mutate()}
                  >
                    {props.assignAbm.isPending ? "Assigning…" : "Assign to Mattrax"}
                  </Button>
                </Show>
                <Show when={abm().enrollmentState === "ASSIGNED" && props.writable}>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={props.adeProfile.isPending}
                    onClick={() => props.adeProfile.mutate()}
                  >
                    {props.adeProfile.isPending ? "Creating link…" : "Get ADE profile link"}
                  </Button>
                </Show>
              </div>
              <Show when={props.adeUrl()}>
                {(url) => (
                  <p class="break-all rounded-lg border border-border bg-surface p-2 font-mono text-[11px] text-muted-foreground">
                    {url()}
                  </p>
                )}
              </Show>
              <ErrorText error={props.assignAbm.error ?? props.adeProfile.error} />
            </>
          )}
        </Show>
      </div>
    </Panel>
  );
}

export default function DeviceDetailPage() {
  const params = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { can } = useCan();
  const writable = () => can("devices.write");
  const canCommand = () => can("devices.command");
  /** The server derives the legal action set from platform, status and reported capabilities. */
  const supports = (action: string) => (row()?.actions ?? []).some((name) => name === action);
  const canRevealKey = () => can("devices.recovery_key");

  const device = useQuery(() => ({
    queryKey: enterpriseKeys.item(params.tenantId, "device", params.deviceId),
    queryFn: () => enterprise.get(params.tenantId, "device", params.deviceId),
  }));

  const row = () => Option.getOrUndefined(decodeDeviceRow(device.data));

  const scopeLabel = (scope: string) => {
    if (scope === "direct") return "Direct include";

    if (scope === "group") return "Group include";

    if (scope === "user") return "User include";

    if (scope === "user-group") return "User group include";

    return scope;
  };

  const exclusionLabel = (exclusion: {
    scope: string;
    groupName?: string | null;
    userNames?: ReadonlyArray<string>;
    userGroupName?: string | null;
  }) => {
    if (exclusion.scope === "direct") return "is excluded directly";

    if (exclusion.scope === "user")
      return `is excluded for ${exclusion.userNames?.join(", ") ?? "a user"}`;

    if (exclusion.scope === "user-group")
      return `is excluded for ${exclusion.userGroupName ?? "a directory group"}`;

    return `is excluded by ${exclusion.groupName ?? "a group"}`;
  };

  const audienceNames = (policy: {
    groupNames: ReadonlyArray<string>;
    userNames?: ReadonlyArray<string>;
    userGroupNames?: ReadonlyArray<string>;
  }) => [
    ...new Set([
      ...policy.groupNames,
      ...(policy.userNames ?? []),
      ...(policy.userGroupNames ?? []),
    ]),
  ];

  const deviceUsers = useQuery(() =>
    enterpriseQueries.deviceUsers(params.tenantId, params.deviceId),
  );

  const directory = useQuery(() => enterpriseQueries.directory(params.tenantId));
  const [selectedUsers, setSelectedUsers] = createSignal<Set<string>>(new Set());
  const [usersMessage, setUsersMessage] = createSignal<string | null>(null);
  const [usersDirty, setUsersDirty] = createSignal(false);

  createEffect(
    () => deviceUsers.data,
    (data) => {
      // A background refetch must not discard unsaved checkbox changes.
      if (!data || usersDirty()) return;
      setSelectedUsers(new Set(data.users.map((user) => user.id)));
    },
  );

  const toggleUser = (id: string) => {
    const next = new Set(selectedUsers());

    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedUsers(next);
    setUsersDirty(true);
  };

  const saveUsers = useMutation(() => ({
    mutationFn: () =>
      enterprise.setDeviceUsers(params.tenantId, params.deviceId, [...selectedUsers()]),
    onSuccess: async () => {
      setUsersMessage("Device users saved.");
      setUsersDirty(false);
      await queryClient.invalidateQueries({
        queryKey: enterpriseKeys.deviceUsers(params.tenantId, params.deviceId),
      });
      await queryClient.invalidateQueries({
        queryKey: enterpriseKeys.deviceEffectivePolicy(params.tenantId, params.deviceId),
      });
    },
  }));

  const [name, setName] = createSignal("");
  const [assetTag, setAssetTag] = createSignal("");
  const [notes, setNotes] = createSignal("");
  const [editOpen, setEditOpen] = createSignal(false);
  const [tab, setTab] = createSignal<"overview" | "scope">("overview");
  const [selectedGroupId, setSelectedGroupId] = createSignal("");

  const [confirmAction, setConfirmAction] = createSignal<"unenroll" | "delete" | "revoke" | null>(
    null,
  );

  const [confirmName, setConfirmName] = createSignal("");

  const closeConfirm = () => {
    setConfirmName("");
    setConfirmAction(null);
  };

  createEffect(
    () => row()?.id,
    () => {
      const device = row();

      if (device) {
        setName(device.name);
        setAssetTag(device.assetTag ?? "");
        setNotes(device.notes ?? "");
      }
    },
  );

  const invalidate = async () => {
    await queryClient.invalidateQueries({
      queryKey: enterpriseKeys.item(params.tenantId, "device", params.deviceId),
    });
    await queryClient.invalidateQueries({
      queryKey: enterpriseKeys.list(params.tenantId, "device"),
    });
    await queryClient.invalidateQueries({
      queryKey: ["enterprise", "device-search", params.tenantId ?? ""],
    });
    await queryClient.invalidateQueries({
      queryKey: enterpriseKeys.deviceHealth(params.tenantId, params.deviceId),
    });
    await queryClient.invalidateQueries({
      queryKey: enterpriseKeys.deviceHealthSummary(params.tenantId),
    });
    await queryClient.invalidateQueries({
      queryKey: enterpriseKeys.deviceActivity(params.tenantId, params.deviceId),
    });
    await queryClient.invalidateQueries({
      queryKey: enterpriseKeys.deviceEffectivePolicy(params.tenantId, params.deviceId),
    });
    await queryClient.invalidateQueries({
      queryKey: enterpriseKeys.deviceApplications(params.tenantId, params.deviceId),
    });
    await queryClient.invalidateQueries({
      queryKey: enterpriseKeys.applicationInventory(params.tenantId),
    });
    await queryClient.invalidateQueries({
      queryKey: enterpriseKeys.abmDevice(params.tenantId, row()?.serial ?? undefined),
    });
  };

  const save = useMutation(() => ({
    mutationFn: () =>
      enterprise.patchDevice(params.tenantId, params.deviceId, {
        name: name(),
        assetTag: assetTag() || null,
        notes: notes() || null,
      }),
    onSuccess: async () => {
      await invalidate();
      setEditOpen(false);
      toast.success("Device details saved");
    },
    onError: (error) =>
      toast.error("Could not save device details", {
        description: errorMessage(raisedFailure(error), "Try again in a moment."),
      }),
  }));

  const detailsDirty = () =>
    editOpen() &&
    writable() &&
    Boolean(row()) &&
    (name() !== row()!.name ||
      assetTag() !== (row()!.assetTag ?? "") ||
      notes() !== (row()!.notes ?? ""));

  const unsaved = useUnsavedChanges(() => detailsDirty() || usersDirty(), {
    title: "Discard device changes?",
    description: "Device details or linked users have edits that have not been saved.",
  });

  const invalidateGroups = async () => {
    await queryClient.invalidateQueries({
      queryKey: [...enterpriseKeys.item(params.tenantId, "device", params.deviceId), "groups"],
    });
    await queryClient.invalidateQueries({
      queryKey: enterpriseKeys.list(params.tenantId, "group"),
    });
    await invalidate();
  };

  const addToGroup = useMutation(() => ({
    mutationFn: (groupId: string) =>
      enterprise.patchGroupMembers(params.tenantId, groupId, {
        assign: { devices: [params.deviceId!] },
      }),
    onSuccess: async () => {
      setSelectedGroupId("");
      await invalidateGroups();
      toast.success("Device added to group");
    },
    onError: (error) =>
      toast.error("Could not add the device to the group", {
        description: errorMessage(raisedFailure(error), "Try again in a moment."),
      }),
  }));

  const removeFromGroup = useMutation(() => ({
    mutationFn: (groupId: string) =>
      enterprise.patchGroupMembers(params.tenantId, groupId, {
        unassign: { devices: [params.deviceId!] },
      }),
    onSuccess: async () => {
      await invalidateGroups();
      toast.success("Device removed from group");
    },
    onError: (error) =>
      toast.error("Could not remove the device from the group", {
        description: errorMessage(raisedFailure(error), "Try again in a moment."),
      }),
  }));

  const sync = useMutation(() => ({
    mutationFn: () => enterprise.deviceAction(params.tenantId, params.deviceId),
    onSuccess: async () => {
      await invalidate();
      toast.success("Sync requested", {
        description: "The device checks in for pending commands on its next contact.",
      });
    },
    onError: (error) =>
      toast.error("Could not request a sync", {
        description: errorMessage(raisedFailure(error), "Try again in a moment."),
      }),
  }));

  const commands = useQuery(() => ({
    queryKey: [...enterpriseKeys.item(params.tenantId, "device", params.deviceId), "commands"],
    queryFn: () => enterprise.listDeviceCommands(params.tenantId, params.deviceId),
  }));

  const activity = useInfiniteQuery<
    DeviceActivityResponse,
    Error,
    InfiniteData<DeviceActivityResponse>,
    readonly unknown[],
    string | undefined
  >(() => ({
    queryKey: enterpriseKeys.deviceActivity(params.tenantId, params.deviceId),
    queryFn: ({ pageParam }) =>
      enterprise.getDeviceActivity(params.tenantId, params.deviceId, {
        limit: ACTIVITY_PAGE_SIZE,
        cursor: pageParam,
      }),
    initialPageParam: undefined,
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.nextCursor : undefined),
    // Infinite queries are client-driven; the first page during SSR would not
    // carry the request cookie and would render as unauthenticated.
    enabled: Boolean(params.tenantId) && !isServer,
  }));

  const activityEvents = createMemo(() => mergeActivityPages(activity.data?.pages));

  // Command history pages on the client: the endpoint already bounds the
  // response, and this keeps the panel's height predictable.
  const [commandLimit, setCommandLimit] = createSignal(COMMAND_PAGE_SIZE);

  createEffect(
    () => params.deviceId,
    () => {
      setCommandLimit(COMMAND_PAGE_SIZE);
      setTab("overview");
      setEditOpen(false);
      setSelectedGroupId("");
    },
  );

  const commandRows = () => commands.data?.commands ?? [];
  const visibleCommands = () => commandRows().slice(0, commandLimit());
  const hasOlderCommands = () => commandRows().length > commandLimit();
  const commandHistoryTruncated = () => commandRows().length >= COMMAND_FETCH_LIMIT;

  const health = useQuery(() => ({
    queryKey: enterpriseKeys.deviceHealth(params.tenantId, params.deviceId),
    queryFn: () => enterprise.getDeviceHealth(params.tenantId, params.deviceId),
  }));

  const effectivePolicy = useQuery(() =>
    enterpriseQueries.deviceEffectivePolicy(params.tenantId, params.deviceId),
  );

  const applications = useQuery(() =>
    enterpriseQueries.deviceApplications(params.tenantId, params.deviceId),
  );

  /**
   * Device detail does not include group memberships, but the tenant-scoped
   * device search does (the same data the list's Groups column uses). Resolve
   * this device by serial/name once the Scope tab opens. The API gap is
   * reported to the backend owners so this can become a direct read.
   */
  const groupMemberships = useQuery(() => ({
    queryKey: [...enterpriseKeys.item(params.tenantId, "device", params.deviceId), "groups"],
    queryFn: async (): Promise<{ resolved: boolean; groups: readonly GroupMembership[] }> => {
      const term = row()?.serial ?? row()?.name;

      if (!term) return { resolved: true, groups: [] };

      const result = await enterprise.searchDevices(params.tenantId, { q: term, limit: 200 });
      const match = result.devices.find((candidate) => candidate.id === params.deviceId);

      return match ? { resolved: true, groups: match.groups } : { resolved: false, groups: [] };
    },
    enabled: tab() === "scope" && Boolean(params.tenantId && params.deviceId && row()),
  }));

  const groupDirectory = useQuery(() => ({
    queryKey: enterpriseKeys.list(params.tenantId, "group"),
    queryFn: () => enterprise.list(params.tenantId, "group"),
    enabled: tab() === "scope" && Boolean(params.tenantId),
  }));

  const knownGroup = (id: string) => groupDirectory.data?.rows.find((group) => group.id === id);

  const membershipRows = () =>
    (groupMemberships.data?.groups ?? []).map((group) => ({
      ...group,
      kind: knownGroup(group.id)?.kind,
    }));

  const assignedGroupIds = () => new Set((groupMemberships.data?.groups ?? []).map((g) => g.id));

  const joinableGroups = () =>
    (groupDirectory.data?.rows ?? []).filter(
      (group) => group.kind !== "dynamic" && !assignedGroupIds().has(group.id),
    );

  const [adeUrl, setAdeUrl] = createSignal<string | null>(null);

  const assignAbm = useMutation(() => ({
    mutationFn: () => enterprise.assignAbmDevice(params.tenantId, row()!.serial!),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: enterpriseKeys.abmDevice(params.tenantId, row()?.serial ?? undefined),
      });
      await queryClient.invalidateQueries({ queryKey: enterpriseKeys.abm(params.tenantId) });
    },
  }));

  const adeProfile = useMutation(() => ({
    mutationFn: () => enterprise.getAbmDeviceProfileUrl(params.tenantId, row()!.serial!),
    onSuccess: (result) => setAdeUrl(result.url),
  }));

  const resolved = () => Option.getOrUndefined(decodeEffectivePolicy(effectivePolicy.data));
  const [manifestUrl, setManifestUrl] = createSignal("");
  const [lockPin, setLockPin] = createSignal<string | null>(null);
  const [recoveryDialogOpen, setRecoveryDialogOpen] = createSignal(false);
  const [recoveryKey, setRecoveryKey] = createSignal<string | null>(null);
  const [recoveryCopied, setRecoveryCopied] = createSignal(false);

  const command = useMutation(() => ({
    mutationFn: (payload: {
      action:
        | "lock"
        | "wipe"
        | "restart"
        | "shutdown"
        | "clear-passcode"
        | "install-app"
        | "collect-security-info"
        | "refresh-applications";
      manifestUrl?: string;
    }) => enterprise.deviceAction(params.tenantId, params.deviceId, payload),
    onSuccess: async (result) => {
      setLockPin(result.pin ?? null);
      await invalidate();
    },
  }));

  const revealRecoveryKey = useMutation(() => ({
    mutationFn: () => enterprise.getDeviceRecoveryKey(params.tenantId, params.deviceId),
    onSuccess: (result) => {
      setRecoveryKey(result.recoveryKey);
      setRecoveryCopied(false);
    },
  }));

  // Destructive actions close the confirm dialog only after success; on error
  // the dialog stays open so its `ErrorText` is visible.
  const unenroll = useMutation(() => ({
    mutationFn: () => enterprise.deviceUnenroll(params.tenantId, params.deviceId),
    onSuccess: async () => {
      await invalidate();
      closeConfirm();
    },
  }));

  const revokeIdentity = useMutation(() => ({
    mutationFn: () => enterprise.revokeDeviceIdentity(params.tenantId, params.deviceId),
    onSuccess: async () => {
      await invalidate();
      closeConfirm();
    },
  }));

  const remove = useMutation(() => ({
    mutationFn: () =>
      enterprise.deleteDevices(params.tenantId, params.deviceId ? [params.deviceId] : []),
    onSuccess: async () => {
      await invalidate();
      closeConfirm();
      navigate(`/t/${params.tenantId}/devices`);
    },
  }));

  /**
   * The plain-English inventory table from the legacy device page. A row is
   * only present when Mattrax actually has the value: empty rows made the old
   * table look broken, so unknown facts are omitted instead of printed.
   */
  const overviewRows = () => {
    const device = row();

    if (!device) return [];

    const warranty = appleWarrantyUrl(device.proto, device.serial);

    return [
      { label: "Management name", value: device.name },
      { label: "Device name", value: device.physicalName },
      { label: "Device vendor", value: device.vendor },
      { label: "Model name", value: device.model },
      { label: "Asset tag", value: device.assetTag },
      {
        label: "Serial number",
        value: device.serial ? (
          <span class="inline-flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span class="font-mono text-[12px]">{device.serial}</span>
            <Show when={warranty}>
              {(href) => (
                <>
                  <span class="text-muted-foreground" aria-hidden="true">
                    ·
                  </span>
                  <a
                    href={href()}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="font-medium text-brand underline decoration-brand/30 underline-offset-2 hover:decoration-brand"
                  >
                    Check Warranty Coverage
                  </a>
                </>
              )}
            </Show>
          </span>
        ) : undefined,
      },
      { label: "Operating system", value: device.osEdition },
      { label: "Version", value: device.osVersion },
      { label: "Build", value: device.osBuild },
      { label: "Disk size", value: device.diskTotal },
      { label: "Disk used", value: device.diskUsed },
      {
        label: "Full disk encryption",
        value: diskEncryptionLabel(),
      },
      {
        label: "Activation lock",
        value: activationLockLabel(),
      },
      {
        label: "Last seen",
        value: device.lastSeenAt ? (
          <span title={formatDate(device.lastSeenAt)}>{relativeTime(device.lastSeenAt)}</span>
        ) : undefined,
      },
      {
        label: "Enrolled",
        value: device.enrolledAt ? (
          <span title={formatDate(device.enrolledAt)}>{relativeTime(device.enrolledAt)}</span>
        ) : undefined,
      },
    ].filter((entry) => entry.value !== undefined && entry.value !== null && entry.value !== "");
  };

  const fileVaultLabel = () => {
    const status = row()?.fileVaultStatus;

    if (status === "enabled") return "Enabled";

    if (status === "disabled") return "Disabled";

    if (status === "unknown") return "Unknown";
    const value = row()?.fileVaultEnabled;

    if (value === null || value === undefined) return "Not reported";

    return value ? "Enabled" : "Disabled";
  };

  /** FileVault on Apple, BitLocker on Windows; Android does not report either. */
  const diskEncryptionLabel = () => {
    const device = row();

    if (!device) return undefined;

    if (device.fileVaultStatus != null || device.fileVaultEnabled != null) return fileVaultLabel();

    const bitLocker = device.windows?.security.bitLockerEnabled;

    if (bitLocker === null || bitLocker === undefined) return undefined;

    return bitLocker ? "BitLocker enabled" : "BitLocker disabled";
  };

  /**
   * Only render Activation Lock when the device actually reported it. A bypass
   * code is the strongest signal; `isActivationLockManageable` distinguishes a
   * supervised device Mattrax can clear from one it cannot.
   */
  const activationLockLabel = () => {
    const device = row();

    if (!device) return undefined;

    if (device.activationLockBypassCodeEscrowed) return "Bypass code escrowed";

    if (device.isActivationLockManageable === true) return "Manageable";

    if (device.isActivationLockManageable === false) return "Not manageable";

    return undefined;
  };

  const formatBytes = (value?: number | null) => {
    if (value === null || value === undefined || !Number.isFinite(value)) return "—";

    if (value < 1024) return `${value} B`;
    const units = ["KB", "MB", "GB", "TB"];
    let amount = value / 1024;
    let unit = 0;

    while (amount >= 1024 && unit < units.length - 1) {
      amount /= 1024;
      unit++;
    }

    return `${amount.toFixed(amount >= 10 ? 0 : 1)} ${units[unit]}`;
  };

  const copyRecoveryKey = async () => {
    const key = recoveryKey();

    if (!key) return;

    try {
      await navigator.clipboard.writeText(key);
      setRecoveryCopied(true);
    } catch {
      // Clipboard permissions can be denied; the key stays selectable.
      setRecoveryCopied(false);
    }
  };

  const openRecoveryDialog = () => {
    setRecoveryKey(null);
    setRecoveryCopied(false);
    setRecoveryDialogOpen(true);
  };

  const appNames = (): readonly DeviceApplication[] => applications.data?.applications ?? [];

  /** Human label for the raw AMAPI enum values stored on Android devices. */
  const androidLabel = (value: string | null | undefined) => {
    if (!value) return "Not reported";

    if (value === "MANAGEMENT_MODE_UNSPECIFIED" || value === "OWNERSHIP_UNSPECIFIED")
      return "Not reported";

    return value
      .toLowerCase()
      .split("_")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  };

  const capabilityLabels = () => {
    const value = row()?.capabilities;

    if (value == null) return [];

    if (Array.isArray(value)) return value.map((entry) => String(entry));

    if (isString(value)) return [value];

    return [JSON.stringify(value)];
  };

  const certificateDays = (notAfter: string) => {
    const expires = new Date(notAfter);

    if (Number.isNaN(expires.getTime())) return null;

    return Math.ceil((expires.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
  };

  const certificateTone = (notAfter: string, revoked: boolean): ChipTone => {
    if (revoked) return "danger";
    const days = certificateDays(notAfter);

    if (days === null) return "muted";

    if (days <= 7) return "danger";

    if (days <= 30) return "warning";

    return "success";
  };

  const certificateDaysLabel = (notAfter: string) => {
    const expires = new Date(notAfter);

    if (Number.isNaN(expires.getTime())) return "expiry unknown";
    const remaining = expires.getTime() - Date.now();

    if (remaining <= 0) {
      const elapsed = Math.abs(remaining);

      if (elapsed < 60 * 60 * 1000) return "expired";

      if (elapsed < 24 * 60 * 60 * 1000)
        return `expired ${Math.ceil(elapsed / (60 * 60 * 1000))}h ago`;

      return `expired ${Math.ceil(elapsed / (24 * 60 * 60 * 1000))}d ago`;
    }

    const days = Math.ceil(remaining / (24 * 60 * 60 * 1000));

    return `${days}d left`;
  };

  const relativeTime = (value?: string | null) => {
    if (!value) return "Unknown";
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) return value;
    const seconds = Math.round((date.getTime() - Date.now()) / 1000);
    const format = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

    const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
      ["year", 365 * 24 * 60 * 60],
      ["month", 30 * 24 * 60 * 60],
      ["day", 24 * 60 * 60],
      ["hour", 60 * 60],
      ["minute", 60],
    ];

    for (const [unit, size] of units) {
      if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
    }

    return format.format(seconds, "second");
  };

  const activityTone = (kind: string): ChipTone => {
    switch (kind) {
      case "command":
        return "brand";
      case "declaration":
        return "warning";
      case "certificate":
        return "success";
      default:
        return "muted";
    }
  };

  const deliveryTone = (state: PolicyDeliveryState): ChipTone => {
    switch (state) {
      case "delivered":
        return "success";
      case "failed":
        return "danger";
      case "inactive":
      case "pending":
        return "warning";
      default:
        return "muted";
    }
  };

  const deliveryFor = (policy: { policyId: string; kinds: ReadonlyArray<string> }) =>
    policyDeliveryState({
      policyId: policy.policyId,
      kinds: policy.kinds,
      declarations: health.data?.declarations,
      tracked: row()?.proto === "apple",
    });

  const deliveryBadge = (policy: { policyId: string; kinds: ReadonlyArray<string> }) => {
    if (row()?.proto === "apple" && health.isPending)
      return { label: "Checking…", tone: "muted" as const };

    if (row()?.proto === "apple" && health.isError)
      return { label: "Unknown", tone: "muted" as const };

    const state = deliveryFor(policy);

    return { label: policyDeliveryLabel(state), tone: deliveryTone(state) };
  };

  const pushBadge = () => {
    const push = health.data?.push;

    if (!push) return { label: "Unknown", tone: "muted" } as const;

    if (push.invalidToken) return { label: "Re-enroll required", tone: "danger" } as const;

    if (push.consecutiveFailures > 0) return { label: "Failing", tone: "warning" } as const;

    if (push.lastSuccessAt) return { label: "Delivering", tone: "success" } as const;

    return { label: "Not attempted", tone: "muted" } as const;
  };

  const declarationIssues = () =>
    (health.data?.declarations ?? []).filter((declaration) => {
      const valid = declaration.valid.trim().toLowerCase();

      return (
        valid !== "valid" ||
        ((declaration.declarationType === "configurations" ||
          declaration.declarationType === "activations") &&
          !declaration.active)
      );
    });

  const declarationReasons = (reasons: Schema.Json | undefined) => {
    if (reasons === null || reasons === undefined) return [];
    const values = Array.isArray(reasons) ? reasons : [reasons];

    return values
      .map((value) => {
        if (isString(value)) return value;

        const object = Option.getOrUndefined(Schema.decodeUnknownOption(Schema.JsonObject)(value));

        if (object !== undefined)
          return [object.code, object.description].filter(isString).join(": ");

        return "";
      })
      .filter(Boolean);
  };

  const certificates = () => health.data?.certificates ?? [];
  const hasActiveCertificate = () => certificates().some((certificate) => !certificate.revokedAt);

  const confirmDescription = () =>
    Match.value(confirmAction()).pipe(
      Match.when("delete", () => "The device record and its history will be removed."),
      Match.when(
        "revoke",
        () =>
          "The SCEP identity certificates issued to this device will be revoked. The device cannot renew them and may need to re-enroll.",
      ),
      Match.orElse(() => "The device will be asked to remove its management profile."),
    );

  const confirmLabel = () =>
    Match.value(confirmAction()).pipe(
      Match.when("delete", () => "Delete device"),
      Match.when("revoke", () => "Revoke identity"),
      Match.orElse(() => "Unenroll device"),
    );

  const confirmPending = () => unenroll.isPending || remove.isPending || revokeIdentity.isPending;

  /**
   * Each mutation's `onSuccess` closes the dialog. Failures leave it open and
   * the dialog's `ErrorText` renders the mutation error.
   */
  const confirmDestructive = () => {
    const action = confirmAction();

    if (!action) return;

    if (action === "delete") remove.mutate();
    else if (action === "revoke") revokeIdentity.mutate();
    else unenroll.mutate();
  };

  const selectTab = (next: "overview" | "scope") => {
    setTab(next);
    queueMicrotask(() => document.getElementById(`device-tab-${next}`)?.focus());
  };

  const onTabKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;

    event.preventDefault();
    selectTab(tab() === "overview" ? "scope" : "overview");
  };

  return (
    <Page wide>
      {unsaved.prompt}
      <Show
        when={row()}
        fallback={
          <Show when={device.isError} fallback={<PageSkeleton rows={8} />}>
            <Panel>
              <div class="flex flex-col items-start gap-3 py-2">
                <div class="min-w-0">
                  <p class="text-[13px] font-medium text-foreground">
                    This device could not be loaded
                  </p>
                  <p class="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
                    It may have been deleted, or you may not have access to it.
                  </p>
                </div>
                <ErrorText error={device.error} />
                <div class="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={device.isFetching}
                    onClick={() => void device.refetch()}
                  >
                    {device.isFetching ? "Retrying…" : "Try again"}
                  </Button>
                  <Button as="a" size="sm" variant="outline" href={`/t/${params.tenantId}/devices`}>
                    Back to devices
                  </Button>
                </div>
              </div>
            </Panel>
          </Show>
        }
      >
        <>
          <section class="relative overflow-hidden rounded-lg border border-border bg-card">
            <div class="relative flex flex-col gap-4 p-4 sm:p-5 lg:flex-row lg:items-start lg:justify-between">
              <div class="flex min-w-0 items-start gap-4 sm:gap-5">
                <DeviceArtwork proto={row()!.proto} modelIdentifier={row()!.modelIdentifier} />
                <div class="min-w-0 pt-0.5">
                  <PageBreadcrumbs title={row()!.name} />
                  <h1 class="truncate text-[23px] font-[540] leading-[1.1] tracking-[-0.03em] text-foreground sm:text-[26px]">
                    {row()!.name}
                  </h1>
                  <Show when={row()!.model}>
                    {(model) => (
                      <p class="mt-1.5 truncate text-[16px] leading-snug text-muted-foreground sm:text-[20px]">
                        {model()}
                      </p>
                    )}
                  </Show>
                  <div class="mt-3 flex flex-wrap items-center gap-1.5">
                    <DeviceStatusBadge status={row()!.status} />
                    <PlatformBadge proto={row()!.proto} />
                    <DeviceHealthBadge level={health.data?.health.level ?? "unknown"} />
                  </div>
                </div>
              </div>
              <div class="flex flex-wrap items-center gap-2 lg:justify-end">
                <Show when={writable()}>
                  <Button
                    variant="outline"
                    size="icon-sm"
                    class="size-8"
                    aria-label="Edit device details"
                    title="Edit details"
                    onClick={() => setEditOpen(true)}
                  >
                    <SettingsIcon class="size-3.5" />
                  </Button>
                </Show>
                <Show when={canCommand() && supports("sync")}>
                  <Button
                    variant="outline"
                    size="icon-sm"
                    class="size-8"
                    aria-label="Sync device now"
                    title="Sync device now"
                    onClick={() => sync.mutate()}
                    disabled={sync.isPending || row()!.status !== "enrolled"}
                  >
                    <RefreshCw
                      class={`size-3.5 ${sync.isPending ? "animate-spin motion-reduce:animate-none" : ""}`}
                    />
                  </Button>
                </Show>
                <Show when={writable()}>
                  <Show
                    when={row()!.status === "enrolled"}
                    fallback={
                      <Button
                        variant="destructive"
                        size="sm"
                        class="h-8"
                        onClick={() => setConfirmAction("delete")}
                        disabled={remove.isPending}
                      >
                        Delete
                      </Button>
                    }
                  >
                    <Button
                      variant="destructive"
                      size="sm"
                      class="h-8"
                      onClick={() => setConfirmAction("unenroll")}
                      disabled={unenroll.isPending}
                    >
                      Unenroll
                    </Button>
                  </Show>
                </Show>
              </div>
            </div>
          </section>

          <div
            class="no-scrollbar flex gap-0.5 overflow-x-auto border-b border-border"
            role="tablist"
            aria-label="Device sections"
          >
            <For each={["overview", "scope"] as const}>
              {(section) => (
                <button
                  type="button"
                  role="tab"
                  id={`device-tab-${section}`}
                  aria-selected={tab() === section ? "true" : "false"}
                  aria-controls={`device-panel-${section}`}
                  tabindex={tab() === section ? 0 : -1}
                  onClick={() => selectTab(section)}
                  onKeyDown={onTabKeyDown}
                  class={`relative -mb-px shrink-0 rounded-t-md px-3 pb-2.5 pt-2 text-[12.5px] font-medium capitalize transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 ${
                    tab() === section
                      ? "text-foreground after:absolute after:inset-x-2 after:bottom-0 after:h-[2px] after:rounded-full after:bg-foreground"
                      : "text-muted-foreground hover:bg-hover hover:text-foreground"
                  }`}
                >
                  {section}
                </button>
              )}
            </For>
          </div>

          <Show when={tab() === "overview"}>
            <div
              id="device-panel-overview"
              role="tabpanel"
              aria-labelledby="device-tab-overview"
              tabindex="0"
              class="space-y-5 focus-visible:outline-none"
            >
              <Panel
                flush
                title="Overview"
                description="Identity, hardware and management facts reported by the device."
              >
                <table class="w-full text-[12.5px]">
                  <caption class="sr-only">Device inventory</caption>
                  <tbody class="divide-y divide-border">
                    <For each={overviewRows()}>
                      {(entry) => (
                        <tr>
                          <th
                            scope="row"
                            class="w-[42%] px-4 py-2.5 text-left align-top text-[12px] font-medium text-muted-foreground sm:w-[208px]"
                          >
                            {entry.label}
                          </th>
                          <td class="px-4 py-2.5 align-top break-words text-foreground">
                            {entry.value}
                          </td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </Panel>

              <div class="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
                <div class="min-w-0 space-y-5">
                  <Panel
                    title="Health"
                    description="Compliance rollup from enrollment, check-in freshness and declaration state."
                    actions={<DeviceHealthBadge level={health.data?.health.level ?? "unknown"} />}
                  >
                    <Show
                      when={health.data}
                      fallback={
                        <Show when={health.isError} fallback={<SkeletonRows rows={5} />}>
                          <QueryError error={health.error} onRetry={() => void health.refetch()} />
                        </Show>
                      }
                    >
                      <div class="space-y-4">
                        <div class="grid gap-4 sm:grid-cols-2">
                          <div class="space-y-2">
                            <p class="flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
                              Last seen {formatDate(health.data!.health.lastSeenAt)}
                              <Show when={health.data!.health.stale}>
                                <Chip tone="warning">Stale</Chip>
                              </Show>
                            </p>
                            <Show
                              when={health.data!.health.reasons.length > 0}
                              fallback={
                                <p class="text-[12.5px] text-success-foreground">
                                  No compliance or inventory issues detected.
                                </p>
                              }
                            >
                              <ul class="space-y-1.5">
                                <For each={health.data!.health.reasons}>
                                  {(reason) => (
                                    <li class="flex items-start gap-2 text-[12.5px]">
                                      <span
                                        class={Match.value(reason.severity).pipe(
                                          Match.when(
                                            "critical",
                                            () =>
                                              "mt-1.5 size-2 shrink-0 rounded-full bg-destructive",
                                          ),
                                          Match.when(
                                            "warning",
                                            () => "mt-1.5 size-2 shrink-0 rounded-full bg-warning",
                                          ),
                                          Match.orElse(
                                            () =>
                                              "mt-1.5 size-2 shrink-0 rounded-full bg-muted-foreground/50",
                                          ),
                                        )}
                                        aria-hidden="true"
                                      />
                                      <span
                                        class={
                                          reason.severity === "critical"
                                            ? "text-destructive"
                                            : "text-foreground"
                                        }
                                      >
                                        {reason.label}
                                      </span>
                                    </li>
                                  )}
                                </For>
                              </ul>
                            </Show>
                          </div>
                          <div class="space-y-2">
                            <p class="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                              Failing declarations
                              <Show when={(health.data?.declarations.length ?? 0) > 0}>
                                <span class="ml-2 normal-case tracking-normal text-muted-foreground">
                                  {declarationIssues().length} of {health.data?.declarations.length}
                                </span>
                              </Show>
                            </p>
                            <Show
                              when={declarationIssues().length > 0}
                              fallback={
                                <p class="text-[12.5px] text-muted-foreground">
                                  No failing declarations.
                                </p>
                              }
                            >
                              <For each={declarationIssues()}>
                                {(declaration) => (
                                  <div class="rounded-lg border border-border bg-surface p-2 text-[11.5px]">
                                    <div class="flex items-center justify-between gap-2">
                                      <strong class="min-w-0 truncate font-medium">
                                        {declaration.identifier}
                                      </strong>
                                      <span class="shrink-0 text-muted-foreground">
                                        {declaration.valid} ·{" "}
                                        {declaration.active ? "active" : "inactive"}
                                      </span>
                                    </div>
                                    <Show
                                      when={
                                        declarationReasons(
                                          Option.getOrUndefined(decodeJson(declaration.reasons)),
                                        ).length > 0
                                      }
                                    >
                                      <ul class="mt-1 space-y-0.5 text-destructive">
                                        <For
                                          each={declarationReasons(
                                            Option.getOrUndefined(decodeJson(declaration.reasons)),
                                          )}
                                        >
                                          {(reason) => <li>{reason}</li>}
                                        </For>
                                      </ul>
                                    </Show>
                                  </div>
                                )}
                              </For>
                            </Show>
                          </div>
                        </div>

                        <div class="space-y-2 border-t border-border pt-3">
                          <div class="flex flex-wrap items-center justify-between gap-2">
                            <p class="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                              SCEP identity certificates
                            </p>
                            <Show when={certificates().length > 0 && writable()}>
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={!hasActiveCertificate() || revokeIdentity.isPending}
                                onClick={() => setConfirmAction("revoke")}
                              >
                                Revoke identity
                              </Button>
                            </Show>
                          </div>
                          <Show
                            when={certificates().length > 0}
                            fallback={
                              <p class="text-[12.5px] text-muted-foreground">
                                No device-scoped SCEP identity is recorded. Apple SCEP identities
                                are tenant-scoped and cannot be revoked per device.
                              </p>
                            }
                          >
                            <ul class="divide-y divide-border rounded-lg border border-border">
                              <For each={certificates()}>
                                {(certificate) => (
                                  <li class="flex flex-wrap items-center justify-between gap-2 p-2 text-[11.5px]">
                                    <span class="min-w-0 break-all font-mono">
                                      {certificate.serial}
                                    </span>
                                    <span class="flex flex-wrap items-center gap-2">
                                      <span class="text-muted-foreground">
                                        expires {formatDate(certificate.notAfter)}
                                      </span>
                                      <Chip
                                        tone={certificateTone(
                                          certificate.notAfter,
                                          Boolean(certificate.revokedAt),
                                        )}
                                      >
                                        {certificate.revokedAt
                                          ? "revoked"
                                          : certificateDaysLabel(certificate.notAfter)}
                                      </Chip>
                                    </span>
                                    <Chip tone={certificate.revokedAt ? "danger" : "success"}>
                                      {certificate.revokedAt
                                        ? `revoked ${formatDate(certificate.revokedAt)}`
                                        : "active"}
                                    </Chip>
                                  </li>
                                )}
                              </For>
                            </ul>
                          </Show>
                        </div>

                        <Show when={row()!.proto === "apple" && health.data?.push}>
                          <div class="space-y-2 border-t border-border pt-3">
                            <div class="flex flex-wrap items-center justify-between gap-2">
                              <p class="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                                APNs push delivery
                              </p>
                              <Chip tone={pushBadge().tone}>{pushBadge().label}</Chip>
                            </div>
                            <dl class="grid gap-x-6 sm:grid-cols-2">
                              <MetaRow label="Last attempt">
                                {relativeTime(health.data!.push.lastAttemptAt)}
                              </MetaRow>
                              <MetaRow label="Last success">
                                {relativeTime(health.data!.push.lastSuccessAt)}
                              </MetaRow>
                              <MetaRow label="Consecutive failures">
                                {health.data!.push.consecutiveFailures}
                              </MetaRow>
                              <MetaRow label="Push credentials">
                                {health.data!.push.configured ? "Present" : "Missing"}
                              </MetaRow>
                            </dl>
                            <Show when={health.data!.push.lastError}>
                              <p class="rounded-lg border border-destructive/25 bg-destructive/[0.07] p-2 text-[11.5px] text-destructive">
                                {health.data!.push.lastError}
                              </p>
                            </Show>
                            <Show when={health.data!.push.invalidToken}>
                              <p class="text-[11.5px] text-destructive">
                                Apple rejected this device token. The device must re-enroll before
                                it can receive pushes again.
                              </p>
                            </Show>
                          </div>
                        </Show>
                      </div>
                    </Show>
                  </Panel>

                  <Panel
                    title="Security & inventory"
                    description="Key escrow, capabilities and the last inventory snapshot."
                    actions={
                      <Show
                        when={
                          canCommand() && row()!.proto === "apple" && row()!.status === "enrolled"
                        }
                      >
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={command.isPending}
                          onClick={() => command.mutate({ action: "collect-security-info" })}
                        >
                          Collect security info
                        </Button>
                      </Show>
                    }
                  >
                    <div class="space-y-4">
                      <dl class="grid gap-x-6 sm:grid-cols-2">
                        <MetaRow label="FileVault recovery key">
                          <span class="flex flex-wrap items-center justify-end gap-2">
                            <Chip tone={row()!.recoveryKeyEscrowed ? "success" : "warning"}>
                              {row()!.recoveryKeyEscrowed ? "Escrowed" : "Not escrowed"}
                            </Chip>
                            <Show when={row()!.recoveryKeyEscrowed && canRevealKey()}>
                              <Button variant="outline" size="xs" onClick={openRecoveryDialog}>
                                Reveal
                              </Button>
                            </Show>
                          </span>
                        </MetaRow>
                        <MetaRow label="Bootstrap token">
                          <Chip tone={row()!.bootstrapTokenEscrowed ? "success" : "warning"}>
                            {row()!.bootstrapTokenEscrowed ? "Escrowed" : "Not escrowed"}
                          </Chip>
                        </MetaRow>
                        <MetaRow label="Recovery key updated">
                          {formatDate(row()!.recoveryKeyUpdatedAt)}
                        </MetaRow>
                        <MetaRow label="Battery health">
                          {row()!.batteryHealth ?? "Not reported"}
                        </MetaRow>
                        <MetaRow label="Model identifier">
                          {row()!.modelIdentifier ?? "Not reported"}
                        </MetaRow>
                        <MetaRow label="Model number">
                          {row()!.modelNumber ?? "Not reported"}
                        </MetaRow>
                        <MetaRow label="Inventory updated">
                          {formatDate(row()!.inventoryUpdatedAt)}
                        </MetaRow>
                      </dl>
                      <Show when={row()!.proto === "apple" && !row()!.recoveryKeyEscrowed}>
                        <p class="rounded-lg border border-warning/25 bg-warning/[0.07] p-3 text-[12.5px] text-warning-foreground">
                          <strong class="font-medium">
                            No FileVault recovery key is escrowed.
                          </strong>{" "}
                          If FileVault is enabled and the Mac is lost, the disk cannot be unlocked
                          with a Mattrax-held key. Collect security info after FileVault has been
                          enabled on the device.
                        </p>
                      </Show>
                      <Show when={row()!.proto === "apple" && !row()!.bootstrapTokenEscrowed}>
                        <p class="rounded-lg border border-warning/25 bg-warning/[0.07] p-3 text-[12.5px] text-warning-foreground">
                          <strong class="font-medium">No bootstrap token is escrowed.</strong>{" "}
                          Secure-token operations such as granting a user a Secure Token or
                          authorising some software updates may prompt for an administrator.
                        </p>
                      </Show>
                      <div>
                        <p class="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                          Client capabilities
                        </p>
                        <Show
                          when={capabilityLabels().length > 0}
                          fallback={
                            <p class="mt-1 text-[12.5px] text-muted-foreground">
                              No capabilities have been reported yet.
                            </p>
                          }
                        >
                          <div class="mt-2 flex max-h-40 flex-wrap gap-1.5 overflow-auto">
                            <For each={capabilityLabels()}>
                              {(capability) => (
                                <span class="rounded-full border border-border bg-surface px-2 py-0.5 text-[11px] text-muted-foreground">
                                  {capability}
                                </span>
                              )}
                            </For>
                          </div>
                        </Show>
                      </div>
                      <Show when={!row()!.inventoryUpdatedAt}>
                        <p class="text-[11px] text-muted-foreground">
                          Security and inventory values are filled in the next time the device
                          reports its DDM status items.
                        </p>
                      </Show>
                      <ErrorText error={command.error} />
                    </div>
                  </Panel>

                  <Panel
                    flush
                    title="Applications"
                    description={
                      appNames().length > 0
                        ? `${appNames().length} reported · updated ${formatDate(row()!.applicationsUpdatedAt)}`
                        : "Installed applications reported by the device."
                    }
                    actions={
                      <span class="flex flex-wrap items-center justify-end gap-2">
                        <Show when={row()!.applicationsStale}>
                          <Chip tone="warning">
                            {row()!.applicationsUpdatedAt ? "Stale" : "Never reported"}
                          </Chip>
                        </Show>
                        <Show
                          when={
                            canCommand() && row()!.proto === "apple" && row()!.status === "enrolled"
                          }
                        >
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={command.isPending}
                            onClick={() => command.mutate({ action: "refresh-applications" })}
                          >
                            Refresh applications
                          </Button>
                        </Show>
                      </span>
                    }
                  >
                    <Show
                      when={applications.data}
                      fallback={
                        <div class="p-4 sm:p-5">
                          <Show when={applications.isError} fallback={<SkeletonRows rows={4} />}>
                            <QueryError
                              error={applications.error}
                              onRetry={() => void applications.refetch()}
                            />
                          </Show>
                        </div>
                      }
                    >
                      <Show
                        when={appNames().length > 0}
                        fallback={
                          <p class="px-4 py-6 text-[12.5px] text-muted-foreground sm:px-5">
                            No installed applications have been reported yet. Apple devices are
                            refreshed daily; Android devices report on every status notification and
                            Windows devices daily.
                          </p>
                        }
                      >
                        <ul class="max-h-96 divide-y divide-border overflow-auto">
                          <For each={appNames()}>
                            {(application) => (
                              <li class="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-[12.5px] sm:px-5">
                                <span class="min-w-0 flex-1">
                                  <span class="block truncate font-medium text-foreground">
                                    {application.name ?? application.bundleId}
                                  </span>
                                  <span class="block truncate font-mono text-[10.5px] text-muted-foreground">
                                    {application.bundleId}
                                    <Show when={application.publisher}>
                                      {" · "}
                                      {application.publisher}
                                    </Show>
                                  </span>
                                </span>
                                <span class="flex shrink-0 flex-wrap items-center justify-end gap-1.5 text-[11px]">
                                  <span class="tabular-nums text-muted-foreground">
                                    {application.version ?? application.shortVersion ?? "—"}
                                  </span>
                                  <span class="tabular-nums text-muted-foreground">
                                    {formatBytes(application.bundleSize)}
                                  </span>
                                  <Show when={application.isManaged}>
                                    <Chip tone="brand">Managed</Chip>
                                  </Show>
                                  <Show when={application.hasUpdateAvailable}>
                                    <Chip tone="warning">Update available</Chip>
                                  </Show>
                                </span>
                              </li>
                            )}
                          </For>
                        </ul>
                      </Show>
                    </Show>
                  </Panel>

                  <Show when={row()!.android}>
                    {(android) => (
                      <Panel
                        title="Android management"
                        description="State reported by the Android Management API."
                      >
                        <dl class="grid gap-x-6 sm:grid-cols-2">
                          <MetaRow label="Management mode">
                            {androidLabel(android().managementMode)}
                          </MetaRow>
                          <MetaRow label="Ownership">{androidLabel(android().ownership)}</MetaRow>
                          <MetaRow label="Google state">{androidLabel(android().state)}</MetaRow>
                          <MetaRow label="API level">
                            {android().apiLevel === null
                              ? "Not reported"
                              : String(android().apiLevel)}
                          </MetaRow>
                          <MetaRow label="Security patch">
                            {android().securityPatchLevel ?? "Not reported"}
                          </MetaRow>
                          <MetaRow label="Applied policy">
                            <span class="break-all font-mono text-[11px]">
                              {android().appliedPolicyName ?? "Not reported"}
                            </span>
                          </MetaRow>
                          <MetaRow label="Network operator">
                            {android().networkOperator ?? "Not reported"}
                          </MetaRow>
                          <MetaRow label="Memory">
                            {android().totalRam === null
                              ? "Not reported"
                              : formatBytes(android().totalRam)}
                          </MetaRow>
                          <MetaRow label="Enrollment token">
                            <span class="break-all font-mono text-[11px]">
                              {android().enrollmentTokenName ?? "Not reported"}
                            </span>
                          </MetaRow>
                        </dl>
                        <Show when={android().disabledReason}>
                          {(reason) => (
                            <p class="mt-3 rounded-lg border border-warning/25 bg-warning/[0.07] p-3 text-[12.5px] text-warning-foreground">
                              {reason()}
                            </p>
                          )}
                        </Show>
                      </Panel>
                    )}
                  </Show>

                  <Show when={row()!.proto === "apple" && row()!.serial}>
                    {(serial) => (
                      <Errored
                        fallback={() => (
                          <Panel
                            title="Apple Business Manager"
                            description="Automated Device Enrollment state for this serial."
                          >
                            <p class="text-[12.5px] text-muted-foreground">
                              This serial is not in the tenant's Apple Business Manager inventory.
                              Upload an ABM credential and sync devices in Settings → Management.
                            </p>
                          </Panel>
                        )}
                      >
                        <AbmPanel
                          tenantId={params.tenantId}
                          serial={serial()}
                          writable={can("management.write")}
                          assignAbm={assignAbm}
                          adeProfile={adeProfile}
                          adeUrl={adeUrl}
                        />
                      </Errored>
                    )}
                  </Show>

                  <Show when={row()!.autopilot}>
                    {(autopilot) => (
                      <Panel
                        title="Windows Autopilot"
                        description="Profile and enrollment state read from Microsoft Graph."
                      >
                        <dl class="grid gap-x-6 sm:grid-cols-2">
                          <MetaRow label="Autopilot serial">
                            <span class="font-mono text-[11px]">{autopilot().serial}</span>
                          </MetaRow>
                          <MetaRow label="Group tag">{autopilot().groupTag ?? "None"}</MetaRow>
                          <MetaRow label="Profile state">{autopilot().profileStatus}</MetaRow>
                          <MetaRow label="Enrollment state">{autopilot().enrollmentState}</MetaRow>
                          <MetaRow label="Entra device id">
                            <span class="break-all font-mono text-[11px]">
                              {autopilot().azureAdDeviceId ?? "Not joined yet"}
                            </span>
                          </MetaRow>
                          <MetaRow label="Last Autopilot sync">
                            {autopilot().lastSyncedAt
                              ? formatDate(autopilot().lastSyncedAt!)
                              : "Never"}
                          </MetaRow>
                        </dl>
                        <p class="mt-3 text-[11px] text-muted-foreground">
                          Autopilot profile and enrollment state are read from Microsoft Graph.
                          Manage imports and profiles in Settings → Management.
                        </p>
                      </Panel>
                    )}
                  </Show>
                </div>

                <div class="min-w-0 space-y-5">
                  <Panel
                    title="Notes"
                    description="Read-only Markdown notes saved with this device."
                    actions={
                      <Show when={writable()}>
                        <Button variant="outline" size="xs" onClick={() => setEditOpen(true)}>
                          Edit
                        </Button>
                      </Show>
                    }
                  >
                    <Show
                      when={row()!.notes?.trim()}
                      fallback={
                        <p class="text-[12.5px] text-muted-foreground">
                          No notes. Add a note from Edit details.
                        </p>
                      }
                    >
                      {(content) => <Markdown content={content()} />}
                    </Show>
                  </Panel>

                  <Panel
                    title="Users"
                    description="User-assigned policies follow these directory users to this device."
                  >
                    <div class="space-y-3">
                      <p class="rounded-lg border border-border bg-muted/15 px-3 py-2 text-[12px] leading-relaxed text-muted-foreground">
                        Policies assigned to a user are delivered on the device channel. They affect
                        every user on this device, not only the linked account. Windows applies
                        changes on its next check-in.
                      </p>
                      <Show
                        when={directory.data}
                        fallback={
                          <Show when={directory.isError} fallback={<SkeletonRows rows={4} />}>
                            <QueryError
                              error={directory.error}
                              onRetry={() => void directory.refetch()}
                            />
                          </Show>
                        }
                      >
                        <Show
                          when={
                            (directory.data?.users ?? []).filter((user) => !user.disabled).length >
                            0
                          }
                          fallback={
                            <p class="text-[12.5px] text-muted-foreground">
                              No directory users. Sync Entra or SCIM first.
                            </p>
                          }
                        >
                          <div class="max-h-64 divide-y divide-border/60 overflow-auto rounded-lg border border-border">
                            <For
                              each={(directory.data?.users ?? []).filter((user) => !user.disabled)}
                            >
                              {(user) => (
                                <label class="flex items-center gap-2.5 px-2.5 py-1.5 text-[13px] transition-colors hover:bg-muted/30">
                                  <input
                                    type="checkbox"
                                    checked={selectedUsers().has(user.id)}
                                    disabled={!writable()}
                                    onChange={() => toggleUser(user.id)}
                                    class="size-3.5 rounded border-border"
                                  />
                                  <span class="min-w-0 flex-1">
                                    <span class="block truncate text-foreground">{user.name}</span>
                                    <span class="block truncate text-[11px] text-muted-foreground">
                                      {user.email}
                                    </span>
                                  </span>
                                  <Badge variant="outline" class="shrink-0 text-[10px]">
                                    {user.source}
                                  </Badge>
                                </label>
                              )}
                            </For>
                          </div>
                        </Show>
                      </Show>
                      <ErrorText error={saveUsers.error} />
                      <Show when={usersMessage()}>
                        {(text) => (
                          <p
                            role="status"
                            class="rounded-lg border border-success/25 bg-success/[0.07] px-3 py-2 text-[12.5px] text-success-foreground"
                          >
                            {text()}
                          </p>
                        )}
                      </Show>
                      <Show
                        when={writable()}
                        fallback={
                          <ReadOnlyNotice>
                            Your role can view linked users but not change them.
                          </ReadOnlyNotice>
                        }
                      >
                        <Button disabled={saveUsers.isPending} onClick={() => saveUsers.mutate()}>
                          {saveUsers.isPending ? "Saving…" : "Save users"}
                        </Button>
                      </Show>
                    </div>
                  </Panel>

                  <Show
                    when={
                      (row()!.proto === "apple" ||
                        row()!.proto === "win" ||
                        row()!.proto === "android") &&
                      row()!.status === "enrolled" &&
                      canCommand()
                    }
                  >
                    <Panel
                      title="Remote actions"
                      description={
                        row()!.proto === "android"
                          ? "Commands are sent to the device through Android Management."
                          : "Commands are queued and delivered on the device's next check-in."
                      }
                    >
                      <div class="space-y-3">
                        <div class="grid grid-cols-2 gap-2">
                          <Show when={supports("lock")}>
                            <Button
                              variant="outline"
                              disabled={command.isPending}
                              onClick={() => command.mutate({ action: "lock" })}
                            >
                              Lock
                            </Button>
                          </Show>
                          <Show when={supports("restart")}>
                            <Button
                              variant="outline"
                              disabled={command.isPending}
                              onClick={() => command.mutate({ action: "restart" })}
                            >
                              Restart
                            </Button>
                          </Show>
                          <Show when={supports("shutdown")}>
                            <Button
                              variant="outline"
                              disabled={command.isPending}
                              onClick={() => command.mutate({ action: "shutdown" })}
                            >
                              Shut down
                            </Button>
                          </Show>
                          <Show when={supports("clear-passcode")}>
                            <Button
                              variant="outline"
                              disabled={command.isPending}
                              onClick={() => command.mutate({ action: "clear-passcode" })}
                            >
                              Clear passcode
                            </Button>
                          </Show>
                          <Show when={supports("wipe")}>
                            <Button
                              variant="destructive"
                              class="col-span-2"
                              disabled={command.isPending}
                              onClick={() => {
                                if (
                                  window.confirm(
                                    "Erase this device? This cannot be undone and will wipe all data.",
                                  )
                                )
                                  command.mutate({ action: "wipe" });
                              }}
                            >
                              Erase device
                            </Button>
                          </Show>
                        </div>
                        <Show when={supports("install-app")}>
                          <Field label="Install app from manifest URL">
                            <div class="flex gap-2">
                              <Input
                                value={manifestUrl()}
                                placeholder="https://example.com/manifest.plist"
                                onInput={(event) => setManifestUrl(event.currentTarget.value)}
                              />
                              <Button
                                variant="outline"
                                disabled={command.isPending || !manifestUrl()}
                                onClick={() =>
                                  command.mutate({
                                    action: "install-app",
                                    manifestUrl: manifestUrl(),
                                  })
                                }
                              >
                                Install
                              </Button>
                            </div>
                          </Field>
                        </Show>
                        <Show when={lockPin()}>
                          {(pin) => (
                            <p class="rounded-lg border border-warning/25 bg-warning/[0.07] p-3 text-[12.5px] text-warning-foreground">
                              Device lock PIN: <strong class="font-mono">{pin()}</strong>
                            </p>
                          )}
                        </Show>
                        <ErrorText error={command.error} />
                      </div>
                    </Panel>
                  </Show>

                  <Panel flush title="Activity" description="Newest first.">
                    <Show
                      when={activity.data}
                      fallback={
                        <div class="p-4 sm:p-5">
                          <Show when={activity.isError} fallback={<SkeletonRows rows={5} />}>
                            <QueryError
                              error={activity.error}
                              onRetry={() => void activity.refetch()}
                            />
                          </Show>
                        </div>
                      }
                    >
                      <Show
                        when={activityEvents().length > 0}
                        fallback={
                          <p class="px-4 py-6 text-[12.5px] text-muted-foreground sm:px-5">
                            No activity has been recorded for this device yet.
                          </p>
                        }
                      >
                        <ul class="max-h-[26rem] divide-y divide-border overflow-auto">
                          <For each={activityEvents()}>
                            {(event) => (
                              <li class="px-4 py-2.5 text-[11.5px] sm:px-5">
                                <div class="flex items-center justify-between gap-2">
                                  <span class="flex min-w-0 items-center gap-1.5">
                                    <Chip
                                      tone={activityTone(event.kind)}
                                      class="uppercase tracking-wide"
                                    >
                                      {event.kind}
                                    </Chip>
                                    <strong class="truncate font-medium text-foreground">
                                      {event.title}
                                    </strong>
                                  </span>
                                  <span
                                    class="shrink-0 text-muted-foreground"
                                    title={formatDate(event.at)}
                                  >
                                    {relativeTime(event.at)}
                                  </span>
                                </div>
                                <Show when={event.detail || event.status}>
                                  <p class="mt-1 text-muted-foreground">
                                    {[event.status, event.detail].filter(Boolean).join(" · ")}
                                  </p>
                                </Show>
                              </li>
                            )}
                          </For>
                        </ul>
                      </Show>
                      <div class="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2.5 sm:px-5">
                        <span class="text-[11px] tabular-nums text-muted-foreground">
                          {activityEvents().length}
                          {activity.hasNextPage ? "+" : ""} event
                          {activityEvents().length === 1 ? "" : "s"}
                        </span>
                        <Show when={activity.isFetchNextPageError}>
                          <span role="status" class="text-[11px] text-destructive">
                            Could not load older activity. Try again.
                          </span>
                        </Show>
                        <Show
                          when={activity.hasNextPage}
                          fallback={
                            <span class="text-[11px] text-muted-foreground">
                              All older activity is loaded.
                            </span>
                          }
                        >
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={activity.isFetchingNextPage}
                            onClick={() => void activity.fetchNextPage()}
                          >
                            {activity.isFetchingNextPage
                              ? "Loading older activity…"
                              : "Load older activity"}
                          </Button>
                        </Show>
                      </div>
                    </Show>
                  </Panel>

                  <Show when={commandRows().length > 0 || commands.isError}>
                    <Panel
                      flush
                      title="Command history"
                      description="Remote commands sent to this device."
                    >
                      <Show
                        when={!commands.isError}
                        fallback={
                          <div class="p-4 sm:p-5">
                            <QueryError
                              error={commands.error}
                              onRetry={() => void commands.refetch()}
                            />
                          </div>
                        }
                      >
                        <ul class="max-h-72 divide-y divide-border overflow-auto">
                          <For each={visibleCommands()}>
                            {(historyItem) => (
                              <li class="px-4 py-2.5 text-[11.5px] sm:px-5">
                                <div class="flex items-center justify-between gap-2">
                                  <strong class="min-w-0 truncate font-medium text-foreground">
                                    {historyItem.requestType}
                                  </strong>
                                  <Chip tone={commandStatusTone(historyItem.status)}>
                                    {historyItem.statusLabel}
                                  </Chip>
                                </div>
                                <Show when={historyItem.resultStatus || historyItem.resultDetail}>
                                  <p class="mt-1 text-muted-foreground">
                                    {historyItem.resultStatus ?? ""}{" "}
                                    {historyItem.resultDetail ?? ""}
                                  </p>
                                </Show>
                                <Show
                                  when={
                                    historyItem.expiresAt &&
                                    isActiveCommandStatus(historyItem.status)
                                      ? historyItem.expiresAt
                                      : undefined
                                  }
                                >
                                  {(deadline) => (
                                    <p class="mt-1 text-muted-foreground">
                                      Deadline {formatDate(deadline())}
                                    </p>
                                  )}
                                </Show>
                                <p class="mt-1 text-muted-foreground">
                                  {formatDate(historyItem.createdAt)}
                                </p>
                              </li>
                            )}
                          </For>
                        </ul>
                        <div class="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2.5 sm:px-5">
                          <span class="text-[11px] tabular-nums text-muted-foreground">
                            {visibleCommands().length} of {commandRows().length}
                            {commandHistoryTruncated() ? "+" : ""} command
                            {commandRows().length === 1 ? "" : "s"}
                          </span>
                          <Show when={hasOlderCommands()}>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setCommandLimit((value) => value + COMMAND_PAGE_SIZE)}
                            >
                              Show older commands
                            </Button>
                          </Show>
                          <Show when={commandHistoryTruncated()}>
                            <p class="basis-full text-[11px] text-muted-foreground">
                              Showing the newest {COMMAND_FETCH_LIMIT} commands for this device.
                            </p>
                          </Show>
                        </div>
                      </Show>
                    </Panel>
                  </Show>
                </div>
              </div>
            </div>
          </Show>

          <Show when={tab() === "scope"}>
            <div
              id="device-panel-scope"
              role="tabpanel"
              aria-labelledby="device-tab-scope"
              tabindex="0"
              class="grid items-start gap-5 focus-visible:outline-none lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]"
            >
              <Panel
                title="Groups"
                description="Direct membership and the dynamic groups whose rules currently include this device."
              >
                <div class="space-y-3">
                  <Show
                    when={groupMemberships.data}
                    fallback={
                      <Show when={groupMemberships.isError} fallback={<SkeletonRows rows={3} />}>
                        <QueryError
                          error={groupMemberships.error}
                          onRetry={() => void groupMemberships.refetch()}
                        />
                      </Show>
                    }
                  >
                    {(data) => (
                      <Show
                        when={data().resolved}
                        fallback={
                          <div class="space-y-2 rounded-lg border border-warning/25 bg-warning/[0.07] p-3 text-[12.5px] text-warning-foreground">
                            <p>
                              This device was not returned by the tenant search index, so its group
                              membership could not be resolved.
                            </p>
                            <Button
                              variant="outline"
                              size="xs"
                              onClick={() => void groupMemberships.refetch()}
                            >
                              Try again
                            </Button>
                          </div>
                        }
                      >
                        <Show
                          when={membershipRows().length > 0}
                          fallback={
                            <p class="text-[12.5px] text-muted-foreground">
                              No group includes this device. Add it to a manual group below.
                            </p>
                          }
                        >
                          <ul class="divide-y divide-border rounded-lg border border-border">
                            <For each={membershipRows()}>
                              {(group) => (
                                <li class="flex items-start justify-between gap-3 p-2.5">
                                  <div class="min-w-0">
                                    <a
                                      class="font-medium text-foreground hover:underline"
                                      href={`/t/${params.tenantId}/groups/${group.id}`}
                                    >
                                      {group.name}
                                    </a>
                                    <div class="mt-1 flex flex-wrap items-center gap-1.5">
                                      <Show
                                        when={group.kind}
                                        fallback={<Chip tone="muted">Group</Chip>}
                                      >
                                        {(kind) => (
                                          <Chip tone={kind() === "dynamic" ? "brand" : "muted"}>
                                            {kind() === "dynamic" ? "Dynamic match" : "Manual"}
                                          </Chip>
                                        )}
                                      </Show>
                                      <span class="text-[11px] text-muted-foreground">
                                        {group.kind === "dynamic"
                                          ? "Included by the group's current rules."
                                          : "Assigned directly on this device."}
                                      </span>
                                    </div>
                                  </div>
                                  <Show when={writable() && group.kind === "manual"}>
                                    <Button
                                      variant="ghost"
                                      size="xs"
                                      disabled={removeFromGroup.isPending}
                                      onClick={() => removeFromGroup.mutate(group.id)}
                                    >
                                      Remove
                                    </Button>
                                  </Show>
                                </li>
                              )}
                            </For>
                          </ul>
                        </Show>
                      </Show>
                    )}
                  </Show>

                  <Show
                    when={writable()}
                    fallback={
                      <ReadOnlyNotice>
                        Your role can view group membership but not change it.
                      </ReadOnlyNotice>
                    }
                  >
                    <Show when={groupDirectory.data} fallback={<SkeletonRows rows={1} />}>
                      <Show
                        when={joinableGroups().length > 0}
                        fallback={
                          <p class="border-t border-border pt-3 text-[12px] text-muted-foreground">
                            Every manual group already includes this device.
                          </p>
                        }
                      >
                        <div class="flex flex-col gap-2 border-t border-border pt-3 sm:flex-row">
                          <label class="sr-only" for="device-group-select">
                            Add this device to a group
                          </label>
                          <select
                            id="device-group-select"
                            class={selectClass}
                            value={selectedGroupId()}
                            onChange={(event) => setSelectedGroupId(event.currentTarget.value)}
                          >
                            <option value="">Add to group…</option>
                            <For each={joinableGroups()}>
                              {(group) => <option value={group.id}>{group.name}</option>}
                            </For>
                          </select>
                          <Button
                            size="sm"
                            disabled={!selectedGroupId() || addToGroup.isPending}
                            onClick={() => addToGroup.mutate(selectedGroupId())}
                          >
                            {addToGroup.isPending ? "Adding…" : "Add"}
                          </Button>
                        </div>
                      </Show>
                    </Show>
                  </Show>
                  <QueryError error={groupDirectory.error} />
                  <ErrorText error={addToGroup.error ?? removeFromGroup.error} />
                </div>
              </Panel>

              <Panel
                title="Effective policy"
                description="Policies and setting kinds that resolve for this device right now."
                actions={
                  <span class="text-[11px] tabular-nums text-muted-foreground">
                    {resolved()?.configurations.length ?? 0} resolved kinds
                  </span>
                }
              >
                <Show
                  when={effectivePolicy.data}
                  fallback={
                    <Show when={effectivePolicy.isError} fallback={<SkeletonRows rows={4} />}>
                      <QueryError
                        error={effectivePolicy.error}
                        onRetry={() => void effectivePolicy.refetch()}
                      />
                    </Show>
                  }
                >
                  <div class="space-y-4">
                    <Show
                      when={(resolved()?.policies.length ?? 0) > 0}
                      fallback={
                        <p class="text-[12.5px] text-muted-foreground">
                          No policy resolves for this device. Assign an included policy directly or
                          through a group.
                        </p>
                      }
                    >
                      <div class="space-y-2">
                        <p class="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                          Policies in effect
                        </p>
                        <ul class="divide-y divide-border rounded-lg border border-border">
                          <For each={resolved()?.policies ?? []}>
                            {(policy) => (
                              <li class="space-y-1 p-3 text-[12.5px]">
                                <div class="flex flex-wrap items-center justify-between gap-2">
                                  <a
                                    class="min-w-0 font-medium text-foreground hover:underline"
                                    href={`/t/${params.tenantId}/policies/${policy.policyId}`}
                                  >
                                    {policy.policyName}
                                  </a>
                                  <span class="flex shrink-0 flex-wrap items-center gap-1.5">
                                    <Chip tone={deliveryBadge(policy).tone}>
                                      {deliveryBadge(policy).label}
                                    </Chip>
                                    <Chip tone="muted">priority {policy.priority}</Chip>
                                  </span>
                                </div>
                                <p class="text-[11.5px] text-muted-foreground">
                                  {policy.kinds.length} setting
                                  {policy.kinds.length === 1 ? "" : "s"} ·{" "}
                                  {scopeLabel(policy.scope)}
                                  <Show when={audienceNames(policy).length > 0}>
                                    {" "}
                                    via {audienceNames(policy).join(", ")}
                                  </Show>
                                </p>
                              </li>
                            )}
                          </For>
                        </ul>
                      </div>
                    </Show>

                    <Show
                      when={(resolved()?.configurations.length ?? 0) > 0}
                      fallback={
                        <p class="text-[12.5px] text-muted-foreground">
                          No resolved setting kinds are reported for this device yet.
                        </p>
                      }
                    >
                      <div class="space-y-2">
                        <p class="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                          Resolved settings
                        </p>
                        <ul class="divide-y divide-border rounded-lg border border-border">
                          <For each={resolved()?.configurations ?? []}>
                            {(configuration) => (
                              <li class="space-y-1 p-3 text-[12.5px]">
                                <div class="flex flex-wrap items-center justify-between gap-2">
                                  <span class="min-w-0 font-mono text-[11px] text-muted-foreground">
                                    {configuration.kind}
                                  </span>
                                  <span class="flex shrink-0 flex-wrap items-center gap-1.5">
                                    <Chip tone="muted">{scopeLabel(configuration.scope)}</Chip>
                                    <Chip tone="muted">priority {configuration.priority}</Chip>
                                  </span>
                                </div>
                                <p class="min-w-0">
                                  <a
                                    class="font-medium text-foreground hover:underline"
                                    href={`/t/${params.tenantId}/policies/${configuration.policyId}`}
                                  >
                                    {configuration.policyName}
                                  </a>
                                  <Show when={audienceNames(configuration).length > 0}>
                                    <span class="text-muted-foreground">
                                      {" "}
                                      via {audienceNames(configuration).join(", ")}
                                    </span>
                                  </Show>
                                </p>
                              </li>
                            )}
                          </For>
                        </ul>
                      </div>
                    </Show>

                    <Show when={(resolved()?.overridden.length ?? 0) > 0}>
                      <div>
                        <p class="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                          Overridden policies
                        </p>
                        <ul class="mt-2 space-y-1">
                          <For each={resolved()?.overridden ?? []}>
                            {(override) => (
                              <li class="rounded-lg border border-warning/25 bg-warning/[0.07] p-2 text-[11.5px] text-warning-foreground">
                                <span class="font-medium">{override.policyName}</span> (
                                {override.kind}) lost to {override.reason.replaceAll("-", " ")}.
                              </li>
                            )}
                          </For>
                        </ul>
                      </div>
                    </Show>

                    <Show when={(resolved()?.exclusions.length ?? 0) > 0}>
                      <div>
                        <p class="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                          Exclusions
                        </p>
                        <ul class="mt-2 space-y-1">
                          <For each={resolved()?.exclusions ?? []}>
                            {(exclusion) => (
                              <li
                                class={
                                  exclusion.effective
                                    ? "rounded-lg border border-destructive/25 bg-destructive/[0.07] p-2 text-[11.5px] text-destructive"
                                    : "rounded-lg border border-border bg-surface p-2 text-[11.5px] text-muted-foreground"
                                }
                              >
                                <span class="font-medium">{exclusion.policyName}</span>{" "}
                                {exclusionLabel(exclusion)}.{" "}
                                {exclusion.effective
                                  ? "It removed an applicable assignment."
                                  : "No applicable assignment to remove."}
                              </li>
                            )}
                          </For>
                        </ul>
                      </div>
                    </Show>
                  </div>
                </Show>
              </Panel>
            </div>
          </Show>
        </>
      </Show>

      <Dialog
        open={confirmAction() !== null}
        onOpenChange={(open) => !open && setConfirmAction(null)}
      >
        <DialogContent class="max-w-md">
          <DialogHeader>
            <DialogTitle>{confirmLabel()}?</DialogTitle>
            <DialogDescription>{confirmDescription()}</DialogDescription>
          </DialogHeader>
          <p class="text-sm text-muted-foreground">
            Type <span class="font-mono font-medium">{row()?.name}</span> to confirm.
          </p>
          <Input value={confirmName()} onInput={(e) => setConfirmName(e.currentTarget.value)} />
          <ErrorText error={unenroll.error || remove.error || revokeIdentity.error} />
          <DialogFooter>
            <Button variant="outline" onClick={closeConfirm}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={confirmName() !== row()?.name || confirmPending()}
              onClick={confirmDestructive}
            >
              {confirmPending() ? "Working…" : confirmLabel()}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={recoveryDialogOpen()}
        onOpenChange={(open) => {
          setRecoveryDialogOpen(open);

          if (!open) {
            setRecoveryKey(null);
            setRecoveryCopied(false);
          }
        }}
      >
        <DialogContent class="max-w-lg">
          <DialogHeader>
            <DialogTitle>Reveal FileVault recovery key</DialogTitle>
            <DialogDescription>
              This key can unlock the encrypted disk on this device. Viewing it is recorded in the
              tenant audit log. Do not store it in insecure places.
            </DialogDescription>
          </DialogHeader>
          <Show
            when={recoveryKey()}
            fallback={
              <>
                <p class="text-sm text-muted-foreground">
                  Mattrax will decrypt the escrowed key for <strong>{row()?.name}</strong>.
                </p>
                <ErrorText error={revealRecoveryKey.error} />
                <DialogFooter>
                  <Button variant="outline" onClick={() => setRecoveryDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button
                    disabled={revealRecoveryKey.isPending}
                    onClick={() => revealRecoveryKey.mutate()}
                  >
                    {revealRecoveryKey.isPending ? "Decrypting…" : "Reveal key"}
                  </Button>
                </DialogFooter>
              </>
            }
          >
            {(key) => (
              <>
                <div class="flex items-start gap-2">
                  <code class="min-w-0 flex-1 break-all rounded-lg border border-border bg-surface p-3 font-mono text-sm">
                    {key()}
                  </code>
                  <Button variant="outline" size="sm" onClick={() => void copyRecoveryKey()}>
                    {recoveryCopied() ? "Copied" : "Copy"}
                  </Button>
                </div>
                <p class="text-xs text-muted-foreground">
                  Last received {formatDate(row()?.recoveryKeyUpdatedAt)}
                  <Show when={row()?.recoveryKeyRotatedAt}>
                    {" "}
                    · rotated {formatDate(row()?.recoveryKeyRotatedAt)}
                  </Show>
                </p>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setRecoveryDialogOpen(false)}>
                    Close
                  </Button>
                </DialogFooter>
              </>
            )}
          </Show>
        </DialogContent>
      </Dialog>

      <Sheet
        open={editOpen()}
        onOpenChange={(open) =>
          open ? setEditOpen(true) : unsaved.confirm(() => setEditOpen(false))
        }
      >
        <SheetContent side="right" class="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Edit device details</SheetTitle>
            <SheetDescription>
              The management name, asset tag and Markdown notes are saved with this device.
            </SheetDescription>
          </SheetHeader>
          <form
            class="flex min-h-0 flex-1 flex-col"
            onSubmit={(event) => {
              event.preventDefault();
              save.mutate();
            }}
          >
            <div class="flex-1 space-y-4 overflow-y-auto px-4 pb-4">
              <Field label="Name">
                <Input
                  disabled={!writable()}
                  value={name()}
                  onInput={(event) => setName(event.currentTarget.value)}
                />
              </Field>
              <Field label="Asset tag">
                <Input
                  disabled={!writable()}
                  value={assetTag()}
                  onInput={(event) => setAssetTag(event.currentTarget.value)}
                />
              </Field>
              <Field label="Notes" hint="Markdown is supported.">
                <textarea
                  disabled={!writable()}
                  class="min-h-40 rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30"
                  value={notes()}
                  onInput={(event) => setNotes(event.currentTarget.value)}
                />
              </Field>
              <ErrorText error={save.error} />
            </div>
            <SheetFooter class="border-t border-border">
              <div class="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => unsaved.confirm(() => setEditOpen(false))}
                >
                  Cancel
                </Button>
                <Show when={writable()}>
                  <Button type="submit" disabled={save.isPending}>
                    {save.isPending ? "Saving…" : "Save changes"}
                  </Button>
                </Show>
              </div>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>
    </Page>
  );
}
