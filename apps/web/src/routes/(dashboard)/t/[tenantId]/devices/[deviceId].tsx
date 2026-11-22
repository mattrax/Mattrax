import { useParams } from "@solidjs/router";
import { useNavigate } from "~/lib/navigation";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import type { InfiniteData } from "@tanstack/solid-query";
import { DeviceRow, EffectivePolicyResponse } from "@mattrax/enterprise-domain/client";
import type {
  AttributeDefinitionRow,
  DeviceActivityResponse,
} from "@mattrax/enterprise-domain/client";
import { Match, Option, Schema } from "effect";
import { createEffect, createMemo, createSignal, Errored, For, Show } from "solid-js";
import { isServer } from "@solidjs/web";
import type { JSX } from "@solidjs/web";
import {
  DevicePresenceBadge,
  devicePresence,
  ErrorText,
  Field,
  formatDate,
  formatDeviceDate,
  Page,
  PageBreadcrumbs,
  PageSkeleton,
  PlatformBadge,
  PresenceDot,
  QueryError,
  SkeletonRows,
  usePresenceNow,
} from "~/components/mdm/common";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CheckboxField,
  NativeSelect,
  Tabs,
  TabsList,
  TabsPanel,
  TabsTab,
  Textarea,
} from "@mattrax/ui";
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
  CircleAlert,
  RefreshCw,
  Laptop,
  MonitorSmartphone,
  Settings as SettingsIcon,
  Smartphone,
} from "~/components/ui/icons";
import { enterprise, enterpriseKeys, enterpriseQueries } from "~/lib/enterprise";
import type { DeviceApplication } from "~/lib/enterprise";
import {
  appleUserBindingLabel,
  appleUserDisplayName,
  appleUserEnrollmentLabel,
  appleUserLoginName,
  appleUserPushLabel,
  appleUserPushTone,
} from "~/lib/device-apple-users";
import { appleUserIdentitySourceLabel } from "~/lib/device-apple-users";
import type { AppleUserActionName } from "@mattrax/enterprise-domain/client";
import { Markdown } from "~/components/dashboard/markdown";
import {
  commandStatusTone,
  isActiveCommandStatus,
  mergeActivityPages,
} from "~/lib/device-activity";
import { policyDeliveryLabel, policyDeliveryState } from "~/lib/device-scope";
import type { PolicyDeliveryState } from "~/lib/device-scope";
import {
  appleDeviceArtworkUrl,
  appleWarrantyUrl,
  DEVICE_ARTWORK_WIDTH,
} from "~/lib/device-artwork";
import { errorMessage, raisedFailure } from "~/lib/errors";
import {
  optimisticallyPatchItem,
  optimisticallyRemoveDevices,
  optimisticUpdate,
} from "~/lib/optimistic";
import { toast } from "~/components/toast";
import { ReadOnlyNotice, useCan } from "~/lib/permissions";
import { SoftwareUpdateTag } from "~/components/software-update-badge";
import { OsComplianceTag } from "~/components/os-compliance-badge";
import {
  decodeSoftwareUpdate,
  isMacOsUpdateTracked,
  softwareUpdateReason,
} from "~/lib/software-updates";
import { decodeOsCompliance } from "~/lib/os-compliance";
import { useUnsavedChanges } from "~/lib/unsaved-changes";
import { preloadPage } from "~/lib/page-data";
import { queryClient } from "~/lib/query-client";

type ChipTone = "success" | "warning" | "danger" | "brand" | "muted";

type GroupMembership = {
  id: string;
  name: string;
  source?: "manual" | "dynamic" | "directory" | "nested";
  inheritedFrom?: ReadonlyArray<{ id: string; name: string }>;
};

const ACTIVITY_PAGE_SIZE = 50;

/** The command endpoint returns the newest 200 rows; page them on the client. */
const COMMAND_FETCH_LIMIT = 200;

const COMMAND_PAGE_SIZE = 20;

const decodeDeviceRow = Schema.decodeUnknownOption(DeviceRow);

const decodeEffectivePolicy = Schema.decodeUnknownOption(EffectivePolicyResponse);

const decodeJson = Schema.decodeUnknownOption(Schema.Json);

const isString = Schema.is(Schema.String);

const chipVariants: Record<ChipTone, "success" | "warning" | "destructive" | "brand" | "outline"> =
  {
    success: "success",
    warning: "warning",
    danger: "destructive",
    brand: "brand",
    muted: "outline",
  };

function Chip(props: { tone?: ChipTone; class?: string; children: JSX.Element }) {
  return (
    <Badge variant={chipVariants[props.tone ?? "muted"]} class={props.class}>
      {props.children}
    </Badge>
  );
}

/** Certificate/enrollment faults block a device; policy and check-in ones degrade it. */
const windowsFailureTone = (phase: string): ChipTone =>
  phase === "wstep" || phase === "enrollment" ? "danger" : phase === "policy" ? "warning" : "muted";

const statusMeta = {
  enrolled: { variant: "success", dot: "success" },
  enrolling: { variant: "brand", dot: "info" },
  unenrolling: { variant: "warning", dot: "warning" },
  unenrolled: { variant: "outline", dot: "neutral" },
} as const;

const healthMeta = {
  healthy: { variant: "success", dot: "success", label: "Healthy" },
  attention: { variant: "warning", dot: "warning", label: "Attention" },
  missing: { variant: "info", dot: "info", label: "MIA" },
  critical: { variant: "destructive", dot: "destructive", label: "Critical" },
  unknown: { variant: "outline", dot: "neutral", label: "Unknown" },
} as const;

const isStatus = (value: string): value is keyof typeof statusMeta => value in statusMeta;

const isHealthLevel = (value: string): value is keyof typeof healthMeta => value in healthMeta;

/** Status earns colour; every other badge stays quiet. */
function DeviceStatusTag(props: { status: string }) {
  const meta = () => (isStatus(props.status) ? statusMeta[props.status] : statusMeta.unenrolled);

  return (
    <Badge variant={meta().variant} dot={meta().dot} class="capitalize">
      {props.status}
    </Badge>
  );
}

function DeviceHealthTag(props: { level: string; class?: string }) {
  const meta = () => (isHealthLevel(props.level) ? healthMeta[props.level] : healthMeta.unknown);

  return (
    <Badge variant={meta().variant} dot={meta().dot} class={props.class}>
      {meta().label}
    </Badge>
  );
}

/**
 * The one card used by the device page: title, optional supporting line and a
 * right-aligned action, then the body. No nested surfaces inside.
 */
function DetailCard(props: {
  title: string;
  description?: string;
  action?: JSX.Element;
  flush?: boolean;
  children: JSX.Element;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{props.title}</CardTitle>
        <Show when={props.description}>
          <CardDescription>{props.description}</CardDescription>
        </Show>
        <Show when={props.action}>
          <CardAction>{props.action}</CardAction>
        </Show>
      </CardHeader>
      <CardContent class={props.flush ? "px-0 pb-0 pt-3" : "pt-3"}>{props.children}</CardContent>
    </Card>
  );
}

/** A stacked label/value row used across the detail panels. */
function MetaRow(props: { label: string; children: JSX.Element }) {
  return (
    <div class="flex items-baseline justify-between gap-4 border-b border-border py-2 last:border-0">
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

/** The mutation surface the ABM panel drives; both are device-scoped actions. */
type DeviceActionMutation = {
  readonly isPending: boolean;
  readonly error: Error | null;
  readonly mutate: () => void;
};

function AbmPanel(props: {
  tenantId: string | undefined;
  serial: string | undefined;
  writable: boolean;
  assignAbm: DeviceActionMutation;
  adeProfile: DeviceActionMutation;
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
    <DetailCard
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
                  <p class="break-all rounded-md bg-surface p-2 font-mono text-[11px] text-muted-foreground">
                    {url()}
                  </p>
                )}
              </Show>
              <ErrorText error={props.assignAbm.error ?? props.adeProfile.error} />
            </>
          )}
        </Show>
      </div>
    </DetailCard>
  );
}

export const route = {
  preload: ({
    params,
    intent,
  }: {
    params: { tenantId?: string; deviceId?: string };
    intent: string;
  }) => {
    const tenantId = params.tenantId;
    const deviceId = params.deviceId;

    if (intent === "initial" || !tenantId || !deviceId) return;

    return preloadPage([
      () => queryClient.ensureQueryData(enterpriseQueries.item(tenantId, "device", deviceId)),
      () => queryClient.ensureQueryData(enterpriseQueries.deviceUsers(tenantId, deviceId)),
      () => queryClient.ensureQueryData(enterpriseQueries.deviceApplications(tenantId, deviceId)),
    ]);
  },
};

export default function DeviceDetailPage() {
  // Presence is a function of the clock, so a device drops offline after the
  // 15-minute window even if no new event arrives.
  const presenceNow = usePresenceNow();
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

  const appleUsers = useQuery(() =>
    enterpriseQueries.deviceAppleUsers(params.tenantId, params.deviceId),
  );

  const [appleUserMessage, setAppleUserMessage] = createSignal<string | null>(null);

  const appleUserAction = useMutation(() => ({
    mutationFn: (input: { userId: string; action: AppleUserActionName }) =>
      enterprise.deviceAppleUserAction(
        params.tenantId,
        params.deviceId,
        input.userId,
        input.action,
      ),
    onSuccess: async (_result, input) => {
      setAppleUserMessage(
        input.action === "sync"
          ? "Wake-up sent to the user channel."
          : "Profile refresh queued for the user channel.",
      );
      await queryClient.invalidateQueries({
        queryKey: enterpriseKeys.deviceAppleUsers(params.tenantId, params.deviceId),
      });
      await queryClient.invalidateQueries({
        queryKey: enterpriseKeys.item(params.tenantId, "device", params.deviceId),
      });
    },
  }));

  const bindAppleIdentity = useMutation(() => ({
    mutationFn: (input: { platformUserId: string; userId: string }) =>
      enterprise.bindAppleUserIdentity(
        params.tenantId,
        params.deviceId,
        input.platformUserId,
        input.userId,
      ),
    onSuccess: async () => {
      setAppleUserMessage("Directory identity linked. The user channel will sync its policy.");
      await queryClient.invalidateQueries({
        queryKey: enterpriseKeys.deviceAppleUsers(params.tenantId, params.deviceId),
      });
      await queryClient.invalidateQueries({
        queryKey: enterpriseKeys.deviceEffectivePolicy(params.tenantId, params.deviceId),
      });
    },
  }));

  const unbindAppleIdentity = useMutation(() => ({
    mutationFn: (platformUserId: string) =>
      enterprise.unbindAppleUserIdentity(params.tenantId, params.deviceId, platformUserId),
    onSuccess: async () => {
      setAppleUserMessage(
        "Directory identity removed. This channel no longer receives user policy.",
      );
      await queryClient.invalidateQueries({
        queryKey: enterpriseKeys.deviceAppleUsers(params.tenantId, params.deviceId),
      });
      await queryClient.invalidateQueries({
        queryKey: enterpriseKeys.deviceEffectivePolicy(params.tenantId, params.deviceId),
      });
    },
  }));

  const [name, setName] = createSignal("");
  const [assetTag, setAssetTag] = createSignal("");
  const [notes, setNotes] = createSignal("");
  const [applyName, setApplyName] = createSignal(false);
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

  /**
   * Pushing a name is a device command, so the option needs both the command
   * permission and an Apple device that advertises the action.
   */
  const canApplyName = () =>
    row()?.proto === "apple" && supports("set-device-name") && canCommand();

  /**
   * Null means the administrator never chose. Default the option on for a
   * supervised Apple device, matching the "apply with each sync" default.
   */
  const currentApplyName = () => row()?.namePushEnabled ?? canApplyName();

  createEffect(
    () => row()?.id,
    () => {
      const device = row();

      if (device) {
        setName(device.name);
        setAssetTag(device.assetTag ?? "");
        setNotes(device.notes ?? "");
        setApplyName(device.namePushEnabled ?? canApplyName());
      }
    },
  );

  // Reconcile every view of this device at once. Serial awaits here used to
  // turn one command into a chain of round trips after the UI had already
  // moved on, so the refetches run together and callers do not await them.
  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: enterpriseKeys.item(params.tenantId, "device", params.deviceId),
      }),
      queryClient.invalidateQueries({
        queryKey: enterpriseKeys.list(params.tenantId, "device"),
      }),
      queryClient.invalidateQueries({ queryKey: enterpriseKeys.deviceSearch(params.tenantId) }),
      queryClient.invalidateQueries({
        queryKey: enterpriseKeys.deviceHealth(params.tenantId, params.deviceId),
      }),
      queryClient.invalidateQueries({
        queryKey: enterpriseKeys.deviceHealthSummary(params.tenantId),
      }),
      queryClient.invalidateQueries({
        queryKey: enterpriseKeys.deviceActivity(params.tenantId, params.deviceId),
      }),
      queryClient.invalidateQueries({
        queryKey: enterpriseKeys.deviceEffectivePolicy(params.tenantId, params.deviceId),
      }),
      queryClient.invalidateQueries({
        queryKey: enterpriseKeys.deviceApplications(params.tenantId, params.deviceId),
      }),
      queryClient.invalidateQueries({
        queryKey: enterpriseKeys.applicationInventory(params.tenantId),
      }),
      queryClient.invalidateQueries({
        queryKey: enterpriseKeys.abmDevice(params.tenantId, row()?.serial ?? undefined),
      }),
    ]);
  };

  /**
   * Queue Apple's `Settings`/`DeviceName` command. Kept separate from the
   * rename so a failed push is reported on its own and never rolls back the
   * management name the administrator just saved.
   */
  const applyNameToDevice = useMutation(() => ({
    mutationFn: (deviceName: string) =>
      enterprise.deviceAction(params.tenantId, params.deviceId, {
        action: "set-device-name",
        deviceName,
      }),
    onSuccess: async (_result, deviceName) => {
      toast.success("Device name queued", {
        description: `"${deviceName}" will be applied the next time the device checks in. Follow it under Command history.`,
      });
      await invalidate();
    },
    onError: (error) => {
      toast.error("Could not apply the device name", {
        description: errorMessage(raisedFailure(error), "Try again in a moment."),
      });
    },
  }));

  const save = useMutation(() => ({
    mutationFn: () =>
      enterprise.patchDevice(params.tenantId, params.deviceId, {
        name: name(),
        assetTag: assetTag() || null,
        notes: notes() || null,
        ...(canApplyName() ? { applyNameToDevice: applyName() } : {}),
      }),
    onMutate: async () => {
      const restore = await optimisticallyPatchItem(
        queryClient,
        params.tenantId!,
        "device",
        params.deviceId!,
        { name: name(), assetTag: assetTag() || null, notes: notes() || null },
      );

      // The dialog closes on submit; the header already shows the new values.
      setEditOpen(false);

      return { restore };
    },
    onSuccess: () => {
      toast.success("Device details saved");

      // The rename is already committed. Push it separately so a command
      // failure cannot undo or hide the saved name; the check-in opt-in is
      // the durable retry path. Saving an unrelated field must not queue a
      // command unless the name changed or the option was just turned on.
      const nameChanged = Boolean(row() && name().trim() !== row()!.name);
      const optionTurnedOn = applyName() && currentApplyName() !== true;

      if (canApplyName() && applyName() && name().trim() && (nameChanged || optionTurnedOn))
        applyNameToDevice.mutate(name().trim());

      void invalidate();
    },
    onError: (error, _payload, context) => {
      context?.restore();
      toast.error("Could not save device details", {
        description: errorMessage(raisedFailure(error), "Try again in a moment."),
      });
    },
  }));

  const detailsDirty = () =>
    editOpen() &&
    writable() &&
    Boolean(row()) &&
    (name() !== row()!.name ||
      assetTag() !== (row()!.assetTag ?? "") ||
      notes() !== (row()!.notes ?? "") ||
      (canApplyName() && applyName() !== currentApplyName()));

  const unsaved = useUnsavedChanges(() => detailsDirty() || usersDirty(), {
    title: "Discard device changes?",
    description: "Device details or linked users have edits that have not been saved.",
  });

  /** The device's group memberships resolve through a search; snapshot it so a
   * failed assignment can put the previous list back. */
  const groupsKey = () =>
    [...enterpriseKeys.item(params.tenantId, "device", params.deviceId), "groups"] as const;

  const snapshotGroups = () =>
    optimisticUpdate(
      queryClient,
      groupsKey(),
      (current: { resolved: boolean; groups: readonly GroupMembership[] }) => current,
    );

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
    onMutate: async (groupId) => {
      const name = knownGroup(groupId)?.name ?? groupId;
      const restore = await snapshotGroups();

      queryClient.setQueryData(
        groupsKey(),
        (current: { resolved: boolean; groups: readonly GroupMembership[] } | undefined) =>
          current && !current.groups.some((group) => group.id === groupId)
            ? { ...current, groups: [...current.groups, { id: groupId, name }] }
            : current,
      );

      return { restore };
    },
    onSuccess: () => {
      setSelectedGroupId("");
      toast.success("Device added to group");
      void invalidateGroups();
    },
    onError: (error, _groupId, context) => {
      context?.restore();
      toast.error("Could not add the device to the group", {
        description: errorMessage(raisedFailure(error), "Try again in a moment."),
      });
    },
  }));

  const removeFromGroup = useMutation(() => ({
    mutationFn: (groupId: string) =>
      enterprise.patchGroupMembers(params.tenantId, groupId, {
        unassign: { devices: [params.deviceId!] },
      }),
    onMutate: async (groupId) => {
      const restore = await snapshotGroups();

      queryClient.setQueryData(
        groupsKey(),
        (current: { resolved: boolean; groups: readonly GroupMembership[] } | undefined) =>
          current
            ? { ...current, groups: current.groups.filter((group) => group.id !== groupId) }
            : current,
      );

      return { restore };
    },
    onSuccess: () => {
      toast.success("Device removed from group");
      void invalidateGroups();
    },
    onError: (error, _groupId, context) => {
      context?.restore();
      toast.error("Could not remove the device from the group", {
        description: errorMessage(raisedFailure(error), "Try again in a moment."),
      });
    },
  }));

  const sync = useMutation(() => ({
    mutationFn: () => enterprise.deviceAction(params.tenantId, params.deviceId),
    onSuccess: () => {
      toast.success("Sync requested", {
        description: "The device checks in for pending commands on its next contact.",
      });
      void invalidate();
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
      // The route component is reused across device ids; user selection is
      // device-scoped state and must not leak into the next device.
      setSelectedUsers(new Set<string>());
      setUsersDirty(false);
      setUsersMessage(null);
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

  const windowsFailures = useQuery(() => ({
    ...enterpriseQueries.deviceWindowsFailures(params.tenantId, params.deviceId),
    // Never fetch the history for a non-Windows device: the section does not
    // render and the endpoint would return nothing useful.
    enabled: row()?.proto === "win",
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
      kind: group.source === "directory" ? ("directory" as const) : knownGroup(group.id)?.kind,
    }));

  const assignedGroupIds = () => new Set((groupMemberships.data?.groups ?? []).map((g) => g.id));

  const joinableGroups = () =>
    (groupDirectory.data?.rows ?? []).filter(
      (group) =>
        group.kind !== "dynamic" && !group.directoryGroupId && !assignedGroupIds().has(group.id),
    );

  const membershipTone = (kind: "manual" | "dynamic" | "directory" | undefined) =>
    kind === "dynamic" || kind === "directory" ? "brand" : "muted";

  const membershipLabel = (kind: "manual" | "dynamic" | "directory" | undefined) => {
    if (kind === "dynamic") return "Dynamic match";

    if (kind === "directory") return "Directory";

    return "Manual";
  };

  const membershipDescription = (kind: "manual" | "dynamic" | "directory" | undefined) => {
    if (kind === "dynamic") return "Included by the group's current rules.";

    if (kind === "directory") return "Derived from the linked directory group.";

    return "Assigned directly on this device.";
  };

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
  const [localAdminOpen, setLocalAdminOpen] = createSignal(false);
  const [localAdminPassword, setLocalAdminPassword] = createSignal<string | null>(null);

  const command = useMutation(() => ({
    mutationFn: (payload: {
      action:
        | "lock"
        | "wipe"
        | "return-to-service"
        | "restart"
        | "shutdown"
        | "clear-passcode"
        | "install-app"
        | "collect-security-info"
        | "refresh-applications"
        | "start-lost-mode"
        | "stop-lost-mode"
        | "reset-password"
        | "clear-app-data"
        | "request-device-info"
        | "relinquish-ownership"
        | "schedule-os-update"
        | "set-device-name";
      deviceName?: string;
      manifestUrl?: string;
      osUpdateInstallAction?:
        | "Default"
        | "InstallASAP"
        | "InstallLater"
        | "NotifyOnly"
        | "InstallForceRestart";
      osUpdateProductKey?: string;
      osUpdateDeadline?: string;
    }) => enterprise.deviceAction(params.tenantId, params.deviceId, payload),
    onSuccess: async (result) => {
      setLockPin(result.pin ?? null);

      if (result.returnToService) {
        const summary = result.returnToService;

        toast.success("Return to Service requested", {
          description: summary.automatedDeviceEnrollment
            ? "The device will erase, rejoin Wi-Fi and re-enroll through Automated Device Enrollment."
            : "The device will erase, rejoin Wi-Fi and re-enroll using its embedded enrolment profile.",
        });
      }

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

  const revealLocalAdmin = useMutation(() => ({
    mutationFn: () => enterprise.getDeviceLocalAdmin(params.tenantId, params.deviceId),
    onSuccess: (result) => setLocalAdminPassword(result.password),
  }));

  // Destructive actions close the confirm dialog only after success; on error
  // the dialog stays open so its `ErrorText` is visible.
  const unenroll = useMutation(() => ({
    mutationFn: () => enterprise.deviceUnenroll(params.tenantId, params.deviceId),
    onMutate: async () => {
      const restore = await optimisticallyPatchItem(
        queryClient,
        params.tenantId!,
        "device",
        params.deviceId!,
        { status: "unenrolling" },
      );

      // The confirm dialog dismisses on submit; a failure reopens the state
      // with the row restored and the error toast names the reason.
      closeConfirm();

      return { restore };
    },
    onSuccess: () => void invalidate(),
    onError: (error, _payload, context) => {
      context?.restore();
      toast.error("Could not unenroll the device", {
        description: errorMessage(raisedFailure(error), "Try again in a moment."),
      });
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
    onMutate: async () => {
      const ids = params.deviceId ? [params.deviceId] : [];
      const restore = await optimisticallyRemoveDevices(queryClient, params.tenantId!, ids);

      closeConfirm();
      navigate(`/t/${params.tenantId}/devices`);

      return { restore };
    },
    onSuccess: () => void invalidate(),
    onError: (error, _payload, context) => {
      context?.restore();
      toast.error("Could not delete the device", {
        description: errorMessage(raisedFailure(error), "Try again in a moment."),
      });
    },
  }));

  /** macOS update status carried on the device row; `undefined` on other platforms. */
  const osUpdate = () => decodeSoftwareUpdate(row()?.osUpdate);

  const osCompliance = () => decodeOsCompliance(row()?.osCompliance);

  const [osUpdateAction, setOsUpdateAction] = createSignal<
    "InstallASAP" | "InstallLater" | "NotifyOnly"
  >("InstallASAP");

  const [osUpdateDeadline, setOsUpdateDeadline] = createSignal("");

  /** Only a missing security release or a major upgrade is worth a banner. */
  const osUpdateWarning = () => {
    const info = osUpdate();

    return info &&
      (info.status === "security_update_required" || info.status === "update_available")
      ? info
      : undefined;
  };

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
      {
        label: "Device name",
        value: device.physicalName ? (
          <span class="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>{device.physicalName}</span>
            <Show when={device.nameDrift}>
              <Chip tone="warning">Name drift</Chip>
              <Show when={canCommand() && supports("set-device-name")}>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={applyNameToDevice.isPending}
                  onClick={() => applyNameToDevice.mutate(device.name)}
                >
                  {applyNameToDevice.isPending ? "Queueing…" : "Apply to device"}
                </Button>
              </Show>
            </Show>
          </span>
        ) : undefined,
      },
      {
        label: "Name applied",
        value: device.appliedName
          ? `${device.appliedName} · ${formatDate(device.appliedNameAt)}`
          : undefined,
      },
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
      {
        label: "OS updates",
        value: (() => {
          const info = decodeSoftwareUpdate(device.osUpdate);

          return isMacOsUpdateTracked(info) ? (
            <span class="flex flex-col items-start gap-1">
              <SoftwareUpdateTag info={info} />
              <span class="text-[11px] text-muted-foreground">{softwareUpdateReason(info!)}</span>
            </span>
          ) : undefined;
        })(),
      },
      { label: "Disk size", value: device.diskTotal },
      { label: "Disk used", value: device.diskUsed },
      {
        label: "Full disk encryption",
        value: diskEncryptionLabel(),
      },
      {
        label: "Windows activation",
        value:
          row()?.proto === "win" ? (
            <span class="flex flex-col items-start gap-1">
              <Chip tone={activationTone()}>{activationStatusLabel() ?? "Not reported"}</Chip>
              <Show when={activationDetail()}>
                {(detail) => (
                  <span
                    class="text-[11px] text-muted-foreground"
                    title="Installed edition, licence channel and sample time reported by mattraxd"
                  >
                    {detail()}
                  </span>
                )}
              </Show>
            </span>
          ) : undefined,
      },
      {
        label: "Activation lock",
        value: activationLockLabel(),
      },
      {
        label: "Last seen",
        value: device.lastSeenAt ? (
          <span
            title={formatDeviceDate(device.lastSeenAt)}
            class="inline-flex items-center gap-1.5"
          >
            <PresenceDot online={devicePresence(device, presenceNow()).online} />
            {relativeTime(device.lastSeenAt)}
            <span class="text-muted-foreground">
              {devicePresence(device, presenceNow()).online ? "· online" : "· offline"}
            </span>
          </span>
        ) : undefined,
      },
      {
        label: "Enrolled",
        value: device.enrolledAt ? (
          <span title={formatDeviceDate(device.enrolledAt)}>{relativeTime(device.enrolledAt)}</span>
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
   * Activation is reported by mattraxd's WMI sample, never by the
   * OMA-DM inventory. Other platforms have no activation state at all.
   */
  const windowsActivation = () => row()?.windows?.security.activation;

  const activationStatusLabel = () => {
    const activation = windowsActivation();

    if (!activation) return null;

    if (activation.status === "activated") return "Activated";

    if (activation.status === "not-activated") return "Not activated";

    return "Unknown";
  };

  const activationTone = (): ChipTone => {
    const status = windowsActivation()?.status;

    if (status === "activated") return "success";

    if (status === "not-activated") return "warning";

    return "muted";
  };

  /**
   * Supporting detail for the single activation row: the installed edition
   * (`Win32_OperatingSystem.Caption`), licence channel and sample age. The raw
   * `LicenseStatus` stays in the API for support rather than being shown as an
   * unexplained integer.
   */
  const activationDetail = () => {
    const activation = windowsActivation();

    if (!activation) return null;

    const parts = [
      activation.edition,
      activation.productKeyChannel,
      activation.updatedAt ? `updated ${relativeTime(activation.updatedAt)}` : null,
    ].filter((part): part is string => Boolean(part));

    return parts.length > 0 ? parts.join(" · ") : null;
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

  /**
   * Provisioning mode Google actually gave the device. `DEVICE_OWNER` is a
   * fully managed (company-owned) device; `PROFILE_OWNER` is a work profile on
   * a device that may be personally owned.
   */
  const androidManagementModeLabel = (value: string | null | undefined) => {
    switch (value) {
      case "DEVICE_OWNER":
        return "Fully managed";
      case "PROFILE_OWNER":
        return "Work profile";
      default:
        return "Not reported";
    }
  };

  const androidOwnershipLabel = (value: string | null | undefined) => {
    switch (value) {
      case "COMPANY_OWNED":
        return "Company owned";
      case "PERSONALLY_OWNED":
        return "Personally owned";
      default:
        return "Not reported";
    }
  };

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

    if (Array.isArray(value)) return value.map(String);

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
      Match.when("delete", () =>
        row()?.proto === "android"
          ? "The device is removed from the tenant and this device's Google Enterprise record is deleted, which removes Android Device Policy and the work data it manages. The record and its history are removed from Mattrax. This cannot be undone."
          : "The device record and its history will be removed.",
      ),
      Match.when(
        "revoke",
        () =>
          "The SCEP identity certificates issued to this device will be revoked. The device cannot renew them and may need to re-enroll.",
      ),
      Match.orElse(() =>
        row()?.proto === "android"
          ? "Mattrax deletes this device's Google Enterprise record, which removes Android Device Policy and the work data it manages. To let an employee keep the device for personal use, use Relinquish ownership in Remote actions instead."
          : "The device will be asked to remove its management profile.",
      ),
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

  return (
    <Page wide>
      {unsaved.prompt}
      <Show
        when={row()}
        fallback={
          <Show when={device.isError} fallback={<PageSkeleton rows={8} />}>
            <Card>
              <CardContent class="py-4">
                <div class="flex flex-col items-start gap-3">
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
                    <Button
                      as="a"
                      size="sm"
                      variant="outline"
                      href={`/t/${params.tenantId}/devices`}
                    >
                      Back to devices
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </Show>
        }
      >
        <>
          <section class="relative overflow-hidden rounded-xl border border-border bg-card shadow-card">
            <div class="relative flex flex-col gap-4 p-4 sm:p-5 lg:flex-row lg:items-start lg:justify-between">
              <div class="flex min-w-0 items-start gap-4 sm:gap-5">
                <DeviceArtwork proto={row()!.proto} modelIdentifier={row()!.modelIdentifier} />
                <div class="min-w-0 pt-0.5">
                  <PageBreadcrumbs title={row()!.name} />
                  <h1 class="truncate text-[21px] font-[580] leading-[1.15] tracking-[-0.028em] text-foreground sm:text-[24px]">
                    {row()!.name}
                  </h1>
                  <Show when={row()!.model}>
                    {(model) => (
                      <p class="mt-1 truncate text-[12.5px] leading-5 text-muted-foreground">
                        {model()}
                      </p>
                    )}
                  </Show>
                  <div class="mt-3 flex flex-wrap items-center gap-1.5">
                    <DeviceStatusTag status={row()!.status} />
                    <DevicePresenceBadge
                      status={row()!.status}
                      lastSeenAt={row()!.lastSeenAt}
                      now={presenceNow()}
                    />
                    <PlatformBadge proto={row()!.proto} />
                    <Show when={row()!.awaitingConfiguration}>
                      <Badge variant="warning">Awaiting setup</Badge>
                    </Show>
                    <DeviceHealthTag level={health.data?.health.level ?? "unknown"} />
                    <Show when={isMacOsUpdateTracked(osUpdate())}>
                      <SoftwareUpdateTag info={osUpdate()} />
                    </Show>
                    <Show when={osCompliance()}>
                      {(compliance) => <OsComplianceTag info={compliance()} />}
                    </Show>
                  </div>
                </div>
              </div>
              <div class="flex flex-wrap items-center gap-2 lg:justify-end">
                <Show when={writable()}>
                  <Button
                    variant="outline"
                    size="icon-sm"
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
          <Show when={osUpdateWarning()}>
            {(info) => (
              <div
                role="status"
                class="flex items-start gap-2.5 rounded-xl border border-warning/25 bg-warning/[0.06] px-3.5 py-3 text-[12.5px] leading-relaxed text-warning-foreground"
              >
                <CircleAlert class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <div class="min-w-0 flex-1">
                  <p class="font-medium">
                    {info().status === "security_update_required"
                      ? "Security update required"
                      : "macOS update available"}
                  </p>
                  <p class="mt-0.5 text-muted-foreground">
                    {softwareUpdateReason(info())}
                    <Show when={info().latestVersion}>
                      {" "}
                      The latest release is macOS {info().latestVersion}
                      <Show when={info().releaseDate}> ({formatDate(info().releaseDate)})</Show>.
                    </Show>
                  </p>
                  <Show when={info().securityInfoUrl}>
                    {(href) => (
                      <a
                        href={href()}
                        target="_blank"
                        rel="noopener noreferrer"
                        class="mt-2 inline-flex text-[12px] font-medium text-brand underline decoration-brand/30 underline-offset-2 hover:decoration-brand"
                      >
                        Security details
                      </a>
                    )}
                  </Show>
                </div>
              </div>
            )}
          </Show>
          <Tabs
            value={tab()}
            onValueChange={(value) => {
              if (value === "overview" || value === "scope") setTab(value);
            }}
            class="flex flex-col gap-4"
          >
            <TabsList aria-label="Device sections" class="self-start">
              <TabsTab value="overview">Overview</TabsTab>
              <TabsTab value="scope">Scope</TabsTab>
            </TabsList>

            <TabsPanel value="overview">
              <div class="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
                <div class="min-w-0 space-y-4">
                  <DetailCard
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
                  </DetailCard>
                  <DeviceAttributesPanel
                    tenantId={params.tenantId ?? ""}
                    deviceId={row()?.id ?? ""}
                    values={row()?.attributes}
                    writable={writable()}
                  />
                  <DetailCard
                    title="Security & inventory"
                    description="Key escrow, capabilities and the last inventory snapshot."
                    action={
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
                        <MetaRow label="Local administrator">
                          <span class="flex flex-wrap items-center justify-end gap-2">
                            <Chip tone={row()!.localAdminPasswordEscrowed ? "success" : "warning"}>
                              {row()!.localAdminPasswordEscrowed ? "Escrowed" : "Not created"}
                            </Chip>
                            <Show when={row()!.localAdminPasswordEscrowed && canRevealKey()}>
                              <Button
                                variant="outline"
                                size="xs"
                                onClick={() => {
                                  setLocalAdminPassword(null);
                                  setLocalAdminOpen(true);
                                }}
                              >
                                Reveal
                              </Button>
                            </Show>
                          </span>
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
                      <Show when={row()!.awaitingConfiguration}>
                        <p class="rounded-lg bg-warning/[0.07] p-3 text-[12.5px] text-warning">
                          <strong class="font-medium">Setup is not complete.</strong> The device is
                          held at the Remote Management pane until its local administrator and
                          declarations are applied. Mattrax sends <code>DeviceConfigured</code>{" "}
                          automatically once the declaration report is valid.
                        </p>
                      </Show>
                      <Show when={row()!.proto === "apple" && !row()!.recoveryKeyEscrowed}>
                        <p class="rounded-lg bg-warning/[0.07] p-3 text-[12.5px] text-warning">
                          <strong class="font-medium">
                            No FileVault recovery key is escrowed.
                          </strong>{" "}
                          If FileVault is enabled and the Mac is lost, the disk cannot be unlocked
                          with a Mattrax-held key. Collect security info after FileVault has been
                          enabled on the device.
                        </p>
                      </Show>
                      <Show when={row()!.proto === "apple" && !row()!.bootstrapTokenEscrowed}>
                        <p class="rounded-lg bg-warning/[0.07] p-3 text-[12.5px] text-warning">
                          <strong class="font-medium">No bootstrap token is escrowed.</strong>{" "}
                          Secure-token operations such as granting a user a Secure Token or
                          authorising some software updates may prompt for an administrator.
                        </p>
                      </Show>
                      <div>
                        <p class="label-caps flex flex-wrap items-center gap-2">
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
                  </DetailCard>
                  <Show when={row()!.proto === "win"}>
                    <DetailCard
                      flush
                      title="Enrollment & management failures"
                      description="Newest Windows faults recorded for this device, kept for 30 days."
                    >
                      <Show
                        when={windowsFailures.data}
                        fallback={
                          <div class="p-4 sm:p-5">
                            <Show
                              when={windowsFailures.isError}
                              fallback={<SkeletonRows rows={3} />}
                            >
                              <QueryError
                                error={windowsFailures.error}
                                onRetry={() => void windowsFailures.refetch()}
                              />
                            </Show>
                          </div>
                        }
                      >
                        {(failures) => (
                          <Show
                            when={failures().failures.length > 0}
                            fallback={
                              <p class="px-4 py-6 text-[12.5px] text-muted-foreground sm:px-5">
                                No failures recorded.
                              </p>
                            }
                          >
                            <ul class="divide-y divide-border">
                              <For each={failures().failures}>
                                {(failure) => (
                                  <li class="px-4 py-2.5 text-[11.5px] sm:px-5">
                                    <div class="flex items-center justify-between gap-2">
                                      <span class="flex min-w-0 items-center gap-1.5">
                                        <Chip
                                          tone={windowsFailureTone(failure.phase)}
                                          class="uppercase tracking-wide"
                                        >
                                          {failure.phase}
                                        </Chip>
                                        <strong
                                          class="min-w-0 truncate font-medium text-foreground"
                                          title={failure.message}
                                        >
                                          {failure.message}
                                        </strong>
                                      </span>
                                      <span
                                        class="shrink-0 text-muted-foreground"
                                        title={formatDate(failure.at)}
                                      >
                                        {relativeTime(failure.at)}
                                      </span>
                                    </div>
                                    <Show when={failure.code || failure.detail}>
                                      <p class="mt-1 break-all text-muted-foreground">
                                        {[failure.code, failure.detail].filter(Boolean).join(" · ")}
                                      </p>
                                    </Show>
                                  </li>
                                )}
                              </For>
                            </ul>
                          </Show>
                        )}
                      </Show>
                    </DetailCard>
                  </Show>
                  <DetailCard
                    flush
                    title="Applications"
                    description={
                      appNames().length > 0
                        ? `${appNames().length} reported · updated ${formatDate(row()!.applicationsUpdatedAt)}`
                        : "Installed applications reported by the device."
                    }
                    action={
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
                  </DetailCard>
                  <Show when={row()!.android}>
                    {(android) => (
                      <DetailCard
                        title="Android management"
                        description="State reported by the Android Management API."
                      >
                        <dl class="grid gap-x-6 sm:grid-cols-2">
                          <MetaRow label="Management mode">
                            {androidManagementModeLabel(android().managementMode)}
                          </MetaRow>
                          <MetaRow label="Ownership">
                            {androidOwnershipLabel(android().ownership)}
                          </MetaRow>
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
                            <p class="mt-3 rounded-lg bg-warning/[0.07] p-3 text-[12.5px] text-warning">
                              {reason()}
                            </p>
                          )}
                        </Show>
                      </DetailCard>
                    )}
                  </Show>
                  <Show when={row()!.proto === "apple" && row()!.serial}>
                    {(serial) => (
                      <Errored
                        fallback={() => (
                          <DetailCard
                            title="Apple Business Manager"
                            description="Automated Device Enrollment state for this serial."
                          >
                            <p class="text-[12.5px] text-muted-foreground">
                              This serial is not in the tenant's Apple Business Manager inventory.
                              Upload an ABM credential and sync devices in Settings → Management.
                            </p>
                          </DetailCard>
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
                      <DetailCard
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
                              ? formatDate(autopilot().lastSyncedAt)
                              : "Never"}
                          </MetaRow>
                        </dl>
                        <p class="mt-3 text-[11px] text-muted-foreground">
                          Autopilot profile and enrollment state are read from Microsoft Graph.
                          Manage imports and profiles in Settings → Management.
                        </p>
                      </DetailCard>
                    )}
                  </Show>
                  <DetailCard flush title="Activity" description="Newest first.">
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
                  </DetailCard>
                  <Show when={commandRows().length > 0 || commands.isError}>
                    <DetailCard
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
                    </DetailCard>
                  </Show>
                </div>

                <div class="min-w-0 space-y-4">
                  <DetailCard
                    title="Health"
                    description="Compliance rollup from enrollment, check-in freshness and declaration state."
                    action={<DeviceHealthTag level={health.data?.health.level ?? "unknown"} />}
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
                        <div class="space-y-4">
                          <div class="space-y-2">
                            <p class="flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
                              Last seen {formatDeviceDate(health.data.health.lastSeenAt)}
                              <Show when={health.data.health.level === "missing"}>
                                <Chip tone="brand">MIA</Chip>
                              </Show>
                              <Show
                                when={
                                  health.data.health.stale && health.data.health.level !== "missing"
                                }
                              >
                                <Chip tone="warning">Stale</Chip>
                              </Show>
                            </p>
                            <Show
                              when={health.data.health.reasons.length > 0}
                              fallback={
                                <p class="text-[12.5px] text-success">
                                  No compliance or inventory issues detected.
                                </p>
                              }
                            >
                              <ul class="space-y-1.5">
                                <For each={health.data.health.reasons}>
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
                          <div class="space-y-2 border-t border-border pt-3">
                            <p class="label-caps flex flex-wrap items-center gap-2">
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
                                  <div class="rounded-md bg-surface p-2 text-[11.5px]">
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
                            <p class="label-caps flex flex-wrap items-center gap-2">
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
                            <ul class="divide-y divide-border">
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
                              <p class="label-caps flex flex-wrap items-center gap-2">
                                APNs push delivery
                              </p>
                              <Chip tone={pushBadge().tone}>{pushBadge().label}</Chip>
                            </div>
                            <dl class="grid">
                              <MetaRow label="Last attempt">
                                {relativeTime(health.data.push.lastAttemptAt)}
                              </MetaRow>
                              <MetaRow label="Last success">
                                {relativeTime(health.data.push.lastSuccessAt)}
                              </MetaRow>
                              <MetaRow label="Consecutive failures">
                                {health.data.push.consecutiveFailures}
                              </MetaRow>
                              <MetaRow label="Push credentials">
                                {health.data.push.configured ? "Present" : "Missing"}
                              </MetaRow>
                            </dl>
                            <Show when={health.data.push.lastError}>
                              <p class="rounded-lg bg-destructive/[0.07] p-2 text-[11.5px] text-destructive">
                                {health.data.push.lastError}
                              </p>
                            </Show>
                            <Show when={health.data.push.invalidToken}>
                              <p class="text-[11.5px] text-destructive">
                                Apple rejected this device token. The device must re-enroll before
                                it can receive pushes again.
                              </p>
                            </Show>
                          </div>
                        </Show>
                      </div>
                    </Show>
                  </DetailCard>
                  <DetailCard
                    title="Notes"
                    description="Read-only Markdown notes saved with this device."
                    action={
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
                  </DetailCard>
                  <DetailCard
                    title="Users"
                    description="User-assigned policies follow these directory users to this device."
                  >
                    <div class="space-y-3">
                      <p class="rounded-md bg-surface px-3 py-2 text-[12px] leading-relaxed text-muted-foreground">
                        Device-scoped settings in a user-assigned policy stay on the device channel
                        and affect every user on this device. User-scoped settings are delivered
                        only to a linked, verified Apple user channel below. Windows applies device
                        settings on its next check-in and has no per-login channel.
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
                          when={(directory.data?.users ?? []).some((user) => !user.disabled)}
                          fallback={
                            <p class="text-[12.5px] text-muted-foreground">
                              No directory users. Sync Entra or SCIM first.
                            </p>
                          }
                        >
                          <div class="max-h-64 divide-y divide-border overflow-auto">
                            <For
                              each={(directory.data?.users ?? []).filter((user) => !user.disabled)}
                            >
                              {(user) => (
                                <label class="flex items-center gap-2.5 px-2.5 py-1.5 text-[13px] transition-colors duration-[var(--duration-hover)] ease-swift hover:bg-muted/30">
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
                            class="rounded-lg bg-success/[0.07] px-3 py-2 text-[12.5px] text-success"
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

                      <Show when={row()?.proto === "apple"}>
                        <div class="space-y-2 border-t border-border/60 pt-3">
                          <div class="flex flex-wrap items-center justify-between gap-2">
                            <span class="label-caps">Apple user channels</span>
                            <Show when={appleUsers.data}>
                              <Badge variant="outline" class="shrink-0 text-[10px]">
                                {appleUserEnrollmentLabel(appleUsers.data.enrollmentMode)}
                              </Badge>
                            </Show>
                          </div>
                          <p class="text-[11px] leading-relaxed text-muted-foreground">
                            Every macOS or Shared iPad login Apple manages over the user channel. A
                            channel is created when the user signs in and authenticates with the
                            device's MDM identity. Link a channel to a directory person to deliver
                            user-scoped settings to that login; device-scoped settings stay on the
                            device channel and are never replayed here.
                          </p>
                          <Show
                            when={appleUsers.data}
                            fallback={
                              <Show when={appleUsers.isError} fallback={<SkeletonRows rows={2} />}>
                                <QueryError
                                  error={appleUsers.error}
                                  onRetry={() => void appleUsers.refetch()}
                                />
                              </Show>
                            }
                          >
                            <Show
                              when={appleUsers.data.users.length > 0}
                              fallback={
                                <p class="text-[12.5px] text-muted-foreground">
                                  No user channels yet. A channel appears after the next user signs
                                  in to this Mac or Shared iPad.
                                </p>
                              }
                            >
                              <div class="divide-y divide-border">
                                <For each={appleUsers.data.users}>
                                  {(user) => (
                                    <div class="flex flex-wrap items-start gap-2 px-2.5 py-2">
                                      <div class="min-w-0 flex-1">
                                        <span class="flex items-center gap-1.5">
                                          <span class="truncate text-[13px] text-foreground">
                                            {appleUserDisplayName(user)}
                                          </span>
                                          <Chip tone="muted">
                                            {appleUserBindingLabel(user.binding)}
                                          </Chip>
                                        </span>
                                        <span class="block truncate text-[11px] text-muted-foreground">
                                          {appleUserLoginName(user)} · Last check-in{" "}
                                          {user.lastSeenAt ? formatDate(user.lastSeenAt) : "never"}
                                        </span>
                                        <span class="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                                          <Show
                                            when={user.identity}
                                            fallback={
                                              <Chip tone="muted">No directory identity</Chip>
                                            }
                                          >
                                            {(identity) => (
                                              <>
                                                <Chip tone="success">Linked</Chip>
                                                <span class="min-w-0 truncate text-muted-foreground">
                                                  {identity().name} · {identity().email}
                                                </span>
                                                <span class="text-subtle-foreground">
                                                  ·{" "}
                                                  {appleUserIdentitySourceLabel(identity().source)}
                                                </span>
                                              </>
                                            )}
                                          </Show>
                                        </span>
                                        <NativeSelect
                                          class="mt-1.5 h-7 max-w-[19rem] text-[11.5px]"
                                          value={user.identity?.userId ?? ""}
                                          aria-label={`Directory identity for ${appleUserDisplayName(user)}`}
                                          disabled={
                                            !can("devices.write") ||
                                            bindAppleIdentity.isPending ||
                                            unbindAppleIdentity.isPending
                                          }
                                          onChange={(event) => {
                                            const userId = event.currentTarget.value;

                                            if (userId)
                                              bindAppleIdentity.mutate({
                                                platformUserId: user.platformUserId,
                                                userId,
                                              });
                                            else unbindAppleIdentity.mutate(user.platformUserId);
                                          }}
                                        >
                                          <option value="">No directory identity</option>
                                          <For
                                            each={(directory.data?.users ?? []).filter(
                                              (person) => !person.disabled,
                                            )}
                                          >
                                            {(person) => (
                                              <option value={person.id}>
                                                {person.name} — {person.email}
                                              </option>
                                            )}
                                          </For>
                                        </NativeSelect>
                                        <span class="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                                          <Chip tone={appleUserPushTone(user.push)}>
                                            {appleUserPushLabel(user.push)}
                                          </Chip>
                                          <span>
                                            {user.profiles.length === 1
                                              ? "1 profile"
                                              : `${user.profiles.length} profiles`}
                                          </span>
                                        </span>
                                      </div>
                                      <div class="flex shrink-0 gap-1">
                                        <Show when={user.actions.includes("sync")}>
                                          <Button
                                            variant="outline"
                                            size="xs"
                                            disabled={appleUserAction.isPending}
                                            onClick={() =>
                                              appleUserAction.mutate({
                                                userId: user.platformUserId,
                                                action: "sync",
                                              })
                                            }
                                          >
                                            Wake
                                          </Button>
                                        </Show>
                                        <Show when={user.actions.includes("refresh-profiles")}>
                                          <Button
                                            variant="outline"
                                            size="xs"
                                            disabled={appleUserAction.isPending}
                                            onClick={() =>
                                              appleUserAction.mutate({
                                                userId: user.platformUserId,
                                                action: "refresh-profiles",
                                              })
                                            }
                                          >
                                            Refresh profiles
                                          </Button>
                                        </Show>
                                      </div>
                                    </div>
                                  )}
                                </For>
                              </div>
                            </Show>
                          </Show>
                          <ErrorText error={appleUserAction.error} />
                          <Show when={appleUserMessage()}>
                            {(text) => (
                              <p
                                role="status"
                                class="rounded-lg bg-success/[0.07] px-3 py-2 text-[12.5px] text-success"
                              >
                                {text()}
                              </p>
                            )}
                          </Show>
                          <Show when={!writable()}>
                            <p class="text-[11px] text-muted-foreground">
                              Your role can view user channels but not wake them or queue a profile
                              refresh.
                            </p>
                          </Show>
                        </div>
                      </Show>
                    </div>
                  </DetailCard>
                  <Show
                    when={
                      (row()!.proto === "apple" ||
                        row()!.proto === "win" ||
                        row()!.proto === "android") &&
                      row()!.status === "enrolled" &&
                      canCommand()
                    }
                  >
                    <DetailCard
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
                              size="sm"
                              disabled={command.isPending}
                              onClick={() => command.mutate({ action: "lock" })}
                            >
                              Lock
                            </Button>
                          </Show>
                          <Show when={supports("restart")}>
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={command.isPending}
                              onClick={() => command.mutate({ action: "restart" })}
                            >
                              Restart
                            </Button>
                          </Show>
                          <Show when={supports("shutdown")}>
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={command.isPending}
                              onClick={() => command.mutate({ action: "shutdown" })}
                            >
                              Shut down
                            </Button>
                          </Show>
                          <Show when={supports("clear-passcode")}>
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={command.isPending}
                              onClick={() => command.mutate({ action: "clear-passcode" })}
                            >
                              Clear passcode
                            </Button>
                          </Show>
                          <Show when={supports("start-lost-mode")}>
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={command.isPending}
                              onClick={() => {
                                if (
                                  window.confirm(
                                    "Put this device into lost mode? It locks, and its screen shows a message asking for its return.",
                                  )
                                )
                                  command.mutate({ action: "start-lost-mode" });
                              }}
                            >
                              Start lost mode
                            </Button>
                          </Show>
                          <Show when={supports("stop-lost-mode")}>
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={command.isPending}
                              onClick={() => command.mutate({ action: "stop-lost-mode" })}
                            >
                              End lost mode
                            </Button>
                          </Show>
                          <Show when={supports("reset-password")}>
                            <Button
                              variant="outline"
                              size="sm"
                              class="col-span-2"
                              disabled={command.isPending}
                              onClick={() => {
                                if (
                                  window.confirm(
                                    "Reset the device password? Android Device Policy sets a new temporary password and locks the device. Mattrax never stores or displays the password.",
                                  )
                                )
                                  command.mutate({ action: "reset-password" });
                              }}
                            >
                              Reset password
                            </Button>
                          </Show>
                          <Show when={supports("request-device-info")}>
                            <Button
                              variant="outline"
                              size="sm"
                              class="col-span-2"
                              disabled={command.isPending}
                              onClick={() => command.mutate({ action: "request-device-info" })}
                            >
                              Request device info
                            </Button>
                          </Show>
                          <Show when={supports("clear-app-data")}>
                            <Button
                              variant="outline"
                              size="sm"
                              class="col-span-2 border-destructive/30 text-destructive hover:border-destructive/50 hover:bg-destructive/[0.07] hover:text-destructive"
                              disabled={command.isPending}
                              onClick={() => {
                                if (
                                  window.confirm(
                                    "Clear work-profile app data? Data stored by every managed app on this device is erased. Personal apps and data are not affected.",
                                  )
                                )
                                  command.mutate({ action: "clear-app-data" });
                              }}
                            >
                              Clear app data
                            </Button>
                          </Show>
                          <Show when={supports("relinquish-ownership")}>
                            <Button
                              variant="outline"
                              size="sm"
                              class="col-span-2 border-destructive/30 text-destructive hover:border-destructive/50 hover:bg-destructive/[0.07] hover:text-destructive"
                              disabled={command.isPending}
                              onClick={() => {
                                if (
                                  window.confirm(
                                    "Relinquish ownership of this device? The work profile and all policies are removed, the device leaves the organisation, and Google deletes it from the enterprise once it acknowledges the command. Personal apps and data are kept.",
                                  )
                                )
                                  command.mutate({ action: "relinquish-ownership" });
                              }}
                            >
                              Relinquish ownership
                            </Button>
                          </Show>
                          <Show when={supports("return-to-service")}>
                            <Button
                              variant="outline"
                              size="sm"
                              class="col-span-2 border-destructive/30 text-destructive hover:border-destructive/50 hover:bg-destructive/[0.07] hover:text-destructive"
                              disabled={command.isPending}
                              onClick={() => {
                                if (
                                  window.confirm(
                                    "Return this device to service? It will erase, rejoin the assigned Wi-Fi network and enrol itself again. Apps and data are removed.",
                                  )
                                )
                                  command.mutate({ action: "return-to-service" });
                              }}
                            >
                              Return to service
                            </Button>
                          </Show>
                          <Show when={supports("wipe")}>
                            <Button
                              variant="outline"
                              size="sm"
                              class="col-span-2 border-destructive/30 text-destructive hover:border-destructive/50 hover:bg-destructive/[0.07] hover:text-destructive"
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
                                class="h-7 text-[12px]"
                                value={manifestUrl()}
                                placeholder="https://example.com/manifest.plist"
                                onInput={(event) => setManifestUrl(event.currentTarget.value)}
                              />
                              <Button
                                variant="outline"
                                size="sm"
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
                        <Show when={supports("schedule-os-update")}>
                          <div class="rounded-lg border border-border p-3">
                            <p class="text-[12.5px] font-medium text-foreground">macOS update</p>
                            <p class="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
                              Sends Apple's <code class="font-mono">ScheduleOSUpdate</code> command.
                              It runs on the next check-in and may restart the Mac. Apple has no
                              absolute deadline; <em>Install later</em> lets the user postpone it.
                            </p>
                            <div class="mt-2 grid gap-2 sm:grid-cols-2">
                              <Field label="Install action">
                                <NativeSelect
                                  value={osUpdateAction()}
                                  onChange={(event) => {
                                    const value = event.currentTarget.value;

                                    if (
                                      value === "InstallASAP" ||
                                      value === "InstallLater" ||
                                      value === "NotifyOnly"
                                    )
                                      setOsUpdateAction(value);
                                  }}
                                >
                                  <option value="InstallASAP">Install immediately</option>
                                  <option value="InstallLater">
                                    Install later (user can defer)
                                  </option>
                                  <option value="NotifyOnly">Notify only</option>
                                </NativeSelect>
                              </Field>
                              <Show when={osUpdateAction() === "InstallLater"}>
                                <Field
                                  label="Deadline"
                                  hint="Converted into a bounded deferral count."
                                >
                                  <Input
                                    type="date"
                                    value={osUpdateDeadline()}
                                    onInput={(event) =>
                                      setOsUpdateDeadline(event.currentTarget.value)
                                    }
                                  />
                                </Field>
                              </Show>
                            </div>
                            <Button
                              variant="outline"
                              size="sm"
                              class="mt-2"
                              disabled={command.isPending}
                              onClick={() => {
                                const deadline = osUpdateDeadline();

                                if (
                                  window.confirm(
                                    "Request the latest macOS update on this device? The command is delivered on its next check-in and may restart it.",
                                  )
                                )
                                  command.mutate({
                                    action: "schedule-os-update",
                                    osUpdateInstallAction: osUpdateAction(),
                                    ...(osUpdateAction() === "InstallLater" && deadline
                                      ? {
                                          osUpdateDeadline: new Date(
                                            `${deadline}T23:59:59.000Z`,
                                          ).toISOString(),
                                        }
                                      : {}),
                                  });
                              }}
                            >
                              Request macOS update
                            </Button>
                          </div>
                        </Show>
                        <Show when={lockPin()}>
                          {(pin) => (
                            <p class="rounded-lg bg-warning/[0.07] p-3 text-[12.5px] text-warning">
                              Device lock PIN: <strong class="font-mono">{pin()}</strong>
                            </p>
                          )}
                        </Show>
                        <ErrorText error={command.error} />
                      </div>
                    </DetailCard>
                  </Show>
                </div>
              </div>
            </TabsPanel>

            <TabsPanel value="scope">
              <div class="grid items-start gap-4 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
                <DetailCard
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
                            <div class="space-y-2 rounded-lg bg-warning/[0.07] p-3 text-[12.5px] text-warning">
                              <p>
                                This device was not returned by the tenant search index, so its
                                group membership could not be resolved.
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
                            <ul class="divide-y divide-border">
                              <For each={membershipRows()}>
                                {(group) => (
                                  <li class="flex items-start justify-between gap-3 rounded-md p-2.5 transition-colors duration-[var(--duration-hover)] ease-swift hover:bg-hover">
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
                                            <Chip tone={membershipTone(kind())}>
                                              {membershipLabel(kind())}
                                            </Chip>
                                          )}
                                        </Show>
                                        <span class="text-[11px] text-muted-foreground">
                                          {membershipDescription(group.kind)}
                                        </span>
                                      </div>
                                    </div>
                                    <Show
                                      when={
                                        writable() &&
                                        group.kind === "manual" &&
                                        group.source !== "directory"
                                      }
                                    >
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
                            <NativeSelect
                              id="device-group-select"
                              class="h-7 text-[12px]"
                              value={selectedGroupId()}
                              onChange={(event) => setSelectedGroupId(event.currentTarget.value)}
                            >
                              <option value="">Add to group…</option>
                              <For each={joinableGroups()}>
                                {(group) => <option value={group.id}>{group.name}</option>}
                              </For>
                            </NativeSelect>
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
                </DetailCard>

                <DetailCard
                  title="Effective policy"
                  description="Policies and setting kinds that resolve for this device right now."
                  action={
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
                            No policy resolves for this device. Assign an included policy directly
                            or through a group.
                          </p>
                        }
                      >
                        <div class="space-y-2">
                          <p class="label-caps flex flex-wrap items-center gap-2">
                            Policies in effect
                          </p>
                          <ul class="divide-y divide-border">
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
                          <p class="label-caps flex flex-wrap items-center gap-2">
                            Resolved settings
                          </p>
                          <ul class="divide-y divide-border">
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
                          <p class="label-caps flex flex-wrap items-center gap-2">
                            Overridden policies
                          </p>
                          <ul class="mt-2 space-y-1">
                            <For each={resolved()?.overridden ?? []}>
                              {(override) => (
                                <li class="rounded-lg bg-warning/[0.07] p-2 text-[11.5px] text-warning">
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
                          <p class="label-caps flex flex-wrap items-center gap-2">Exclusions</p>
                          <ul class="mt-2 space-y-1">
                            <For each={resolved()?.exclusions ?? []}>
                              {(exclusion) => (
                                <li
                                  class={
                                    exclusion.effective
                                      ? "rounded-lg bg-destructive/[0.07] p-2 text-[11.5px] text-destructive"
                                      : "rounded-md bg-surface p-2 text-[11.5px] text-muted-foreground"
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
                </DetailCard>
              </div>
            </TabsPanel>
          </Tabs>
        </>
      </Show>

      <Dialog
        open={confirmAction() !== null}
        onOpenChange={(open) => {
          if (!open) closeConfirm();
        }}
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
                  <code class="min-w-0 flex-1 break-all rounded-md bg-surface p-3 font-mono text-sm">
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

      <Dialog
        open={localAdminOpen()}
        onOpenChange={(open) => {
          setLocalAdminOpen(open);

          if (!open) setLocalAdminPassword(null);
        }}
      >
        <DialogContent class="max-w-lg">
          <DialogHeader>
            <DialogTitle>Reveal managed local administrator</DialogTitle>
            <DialogDescription>
              This device was prepared from Setup Assistant. The account is a hidden local
              administrator; viewing its password is recorded in the tenant audit log.
            </DialogDescription>
          </DialogHeader>
          <Show
            when={localAdminPassword()}
            fallback={
              <>
                <ErrorText error={revealLocalAdmin.error} />
                <DialogFooter>
                  <Button variant="outline" onClick={() => setLocalAdminOpen(false)}>
                    Cancel
                  </Button>
                  <Button
                    disabled={revealLocalAdmin.isPending}
                    onClick={() => revealLocalAdmin.mutate()}
                  >
                    {revealLocalAdmin.isPending ? "Decrypting…" : "Reveal password"}
                  </Button>
                </DialogFooter>
              </>
            }
          >
            {(password) => (
              <>
                <dl class="space-y-3 text-sm">
                  <div class="flex items-center justify-between gap-4">
                    <dt class="text-muted-foreground">Username</dt>
                    <dd class="font-mono">{row()?.localAdminUsername ?? "mattrax-admin"}</dd>
                  </div>
                  <div class="flex items-start justify-between gap-4">
                    <dt class="pt-2 text-muted-foreground">Password</dt>
                    <dd class="min-w-0 flex-1">
                      <code class="block break-all rounded-md bg-surface p-3 font-mono text-sm">
                        {password()}
                      </code>
                    </dd>
                  </div>
                </dl>
                <p class="text-xs text-muted-foreground">
                  Last generated {formatDate(row()?.localAdminUpdatedAt)}
                </p>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setLocalAdminOpen(false)}>
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
              The management name, asset tag and Markdown notes are saved with this device. On
              supported Apple devices the name can also be pushed to the device itself.
            </SheetDescription>
          </SheetHeader>
          <form
            class="flex min-h-0 flex-1 flex-col"
            onSubmit={(event) => {
              event.preventDefault();
              save.mutate();
            }}
          >
            <div class="flex-1 space-y-4 overflow-y-auto pb-4">
              <Field label="Name">
                <Input
                  disabled={!writable()}
                  value={name()}
                  onInput={(event) => setName(event.currentTarget.value)}
                />
              </Field>
              <Show when={canApplyName()}>
                <CheckboxField
                  checked={applyName()}
                  onCheckedChange={setApplyName}
                  disabled={!writable()}
                  label="Apply name to device"
                  description="Rename the device itself and re-apply it on check-in while the reported name differs. Only supervised Apple devices accept this command."
                />
              </Show>
              <Field label="Asset tag">
                <Input
                  disabled={!writable()}
                  value={assetTag()}
                  onInput={(event) => setAssetTag(event.currentTarget.value)}
                />
              </Field>
              <Field label="Notes" hint="Markdown is supported.">
                <Textarea
                  disabled={!writable()}
                  class="min-h-40 text-[12.5px]"
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

/**
 * Custom attribute values for one device.
 *
 * Every field is edited inline. Saving sends only the keys that changed: an
 * emptied field is sent as `null` (an explicit clear), untouched keys are left
 * alone. The server re-validates type, options and requiredness.
 */
const attributeInputType = (type: string): "text" | "number" | "date" => {
  if (type === "number") return "number";

  if (type === "date") return "date";

  return "text";
};

const attributeOptionLabel = (type: string, option: string) => {
  if (type !== "boolean") return option;

  return option === "true" ? "Yes" : "No";
};

function DeviceAttributesPanel(props: {
  tenantId: string;
  deviceId: string;
  values: Record<string, string | null> | undefined;
  writable: boolean;
}) {
  const queryClient = useQueryClient();

  const definitions = useQuery(() => ({
    queryKey: enterpriseKeys.attributes(props.tenantId),
    queryFn: () => enterprise.listAttributes(props.tenantId),
  }));

  const [draft, setDraft] = createSignal<Record<string, string>>({});
  const [baseline, setBaseline] = createSignal<Record<string, string>>({});
  const [cleared, setCleared] = createSignal<Record<string, boolean>>({});

  const [error, setError] = createSignal<unknown>();

  // Seed once per device. A background refetch produces a new `values`
  // object and used to wipe an in-progress edit (for example after Sync).
  let seededDeviceId: string | undefined;

  createEffect(
    () => ({ id: props.deviceId, values: props.values }),
    ({ id, values }) => {
      if (seededDeviceId === id || values === undefined) return;

      const next: Record<string, string> = {};

      for (const [key, value] of Object.entries(values)) if (value !== null) next[key] = value;

      seededDeviceId = id;
      setDraft(next);
      setBaseline(next);
      setCleared({});
    },
  );

  const visible = () =>
    (definitions.data?.rows ?? []).filter((definition) => definition.visibility === "visible");

  const dirty = () => {
    const current = draft();
    const original = baseline();
    const clearedKeys = cleared();

    return (
      Object.keys(clearedKeys).some((key) => clearedKeys[key]) ||
      Object.keys(current).some((key) => current[key] !== (original[key] ?? "")) ||
      Object.keys(original).some((key) => !(key in current))
    );
  };

  const save = useMutation(() => ({
    mutationFn: () => {
      const current = draft();
      const original = baseline();
      const values: Record<string, string | null> = {};

      for (const definition of visible()) {
        const next = current[definition.key] ?? "";
        const previous = original[definition.key] ?? "";

        if (next === previous && !cleared()[definition.key]) continue;

        values[definition.key] = next.trim() === "" ? null : next;
      }

      return enterprise.setDeviceAttributes(props.tenantId, props.deviceId, { values });
    },
    onSuccess: async () => {
      setCleared({});
      await queryClient.invalidateQueries({
        queryKey: enterpriseKeys.item(props.tenantId, "device", props.deviceId),
      });
      await queryClient.invalidateQueries({
        queryKey: enterpriseKeys.deviceSearch(props.tenantId),
      });
      toast.success("Device attributes saved");
    },
    onError: (cause) => setError(cause),
  }));

  return (
    <DetailCard
      title="Attributes"
      description="Organisation-specific fields from this tenant's attribute registry."
      action={
        <Show when={props.writable && visible().length > 0}>
          <Button
            size="sm"
            disabled={!dirty() || save.isPending}
            onClick={() => {
              setError(undefined);
              save.mutate();
            }}
          >
            {save.isPending ? "Saving…" : "Save attributes"}
          </Button>
        </Show>
      }
      flush
    >
      <Show
        when={visible().length > 0}
        fallback={
          <p class="px-4 py-4 text-[12.5px] text-muted-foreground">
            {definitions.isPending ? (
              "Loading attributes…"
            ) : (
              <>
                No attributes are defined for this tenant.{" "}
                <a
                  class="underline decoration-border underline-offset-4 hover:text-foreground"
                  href={`/t/${props.tenantId}/settings/attributes`}
                >
                  Create one in Settings → Attributes
                </a>
                .
              </>
            )}
          </p>
        }
      >
        <div class="divide-y divide-border">
          <For each={visible()}>
            {(definition: AttributeDefinitionRow) => {
              const value = () => draft()[definition.key] ?? "";

              const isCleared = () => Boolean(cleared()[definition.key]);

              const setValue = (next: string) => {
                setDraft({ ...draft(), [definition.key]: next });
                setCleared({ ...cleared(), [definition.key]: false });
              };

              return (
                <div class="grid gap-1.5 px-4 py-2.5 sm:grid-cols-[220px_minmax(0,1fr)] sm:items-start sm:gap-4">
                  <div class="min-w-0">
                    <p class="text-[12.5px] font-medium text-foreground">{definition.label}</p>
                    <p class="font-mono text-[10.5px] text-muted-foreground">{definition.key}</p>
                    <Show when={definition.required}>
                      <p class="text-[10.5px] text-warning">Required</p>
                    </Show>
                  </div>
                  <div class="flex items-start gap-2">
                    <Show
                      when={definition.type === "select" || definition.type === "boolean"}
                      fallback={
                        <Input
                          class="h-7 text-[12px]"
                          type={attributeInputType(definition.type)}
                          aria-label={definition.label}
                          disabled={!props.writable}
                          value={value()}
                          onInput={(event) => setValue(event.currentTarget.value)}
                        />
                      }
                    >
                      <NativeSelect
                        class="h-7 text-[12px]"
                        aria-label={definition.label}
                        disabled={!props.writable}
                        value={value()}
                        onChange={(event) => setValue(event.currentTarget.value)}
                      >
                        <option value="">No value</option>
                        <For
                          each={
                            definition.type === "boolean"
                              ? ["true", "false"]
                              : (definition.options ?? [])
                          }
                        >
                          {(option) => (
                            <option value={option}>
                              {attributeOptionLabel(definition.type, option)}
                            </option>
                          )}
                        </For>
                      </NativeSelect>
                    </Show>
                    <Show when={props.writable && value() !== ""}>
                      <Button
                        variant="ghost"
                        size="xs"
                        class="shrink-0 text-muted-foreground"
                        onClick={() => {
                          setDraft({ ...draft(), [definition.key]: "" });
                          setCleared({ ...cleared(), [definition.key]: true });
                        }}
                        aria-label={`Clear ${definition.label}`}
                      >
                        Clear
                      </Button>
                    </Show>
                    <Show when={isCleared()}>
                      <span class="pt-1.5 text-[10.5px] text-warning">Cleared</span>
                    </Show>
                  </div>
                </div>
              );
            }}
          </For>
        </div>
      </Show>
      <div class="px-4 pb-3">
        <ErrorText error={error()} />
        <ErrorText error={definitions.error} />
      </div>
    </DetailCard>
  );
}
