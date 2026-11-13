import { useNavigate, useParams } from "@solidjs/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { createEffect, createSignal, For, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import {
  DeviceHealthBadge,
  DeviceStatusBadge,
  ErrorText,
  Field,
  formatDate,
  Page,
  Panel,
  PlatformBadge,
  QueryError,
} from "~/components/mdm/common";
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
import { ArrowLeft, Laptop, MonitorSmartphone, Smartphone } from "~/components/ui/icons";
import {
  enterprise,
  enterpriseKeys,
  enterpriseQueries,
  type DeviceApplication,
  type DeviceRow,
  type EffectivePolicyResponse,
} from "~/lib/enterprise";

type ChipTone = "success" | "warning" | "danger" | "brand" | "muted";

const chipTones: Record<ChipTone, string> = {
  success: "border-success/25 bg-success/10 text-success-foreground",
  warning: "border-warning/25 bg-warning/10 text-warning-foreground",
  danger: "border-destructive/25 bg-destructive/10 text-destructive",
  brand: "border-brand/25 bg-brand/10 text-brand",
  muted: "border-white/[0.08] bg-white/[0.03] text-muted-foreground",
};

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
    <div class="flex items-start justify-between gap-4 border-b border-white/[0.05] py-2 last:border-0">
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

export default function DeviceDetailPage() {
  const params = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const device = useQuery(() => ({
    queryKey: enterpriseKeys.item(params.tenantId, "device", params.deviceId),
    queryFn: () => enterprise.get(params.tenantId, "device", params.deviceId),
  }));
  const row = () => device.data as DeviceRow | undefined;
  // The ABM lookup is keyed by serial, which only exists once the device query
  // resolves. Mirroring it into a signal keeps the query options free of
  // pending async reads, which throw when evaluated outside a tracking scope.
  const [abmSerial, setAbmSerial] = createSignal<string | undefined>(undefined);
  createEffect(
    () => (row()?.proto === "apple" ? (row()?.serial ?? undefined) : undefined),
    (serial) => {
      setAbmSerial(serial);
    },
  );
  const [name, setName] = createSignal("");
  const [assetTag, setAssetTag] = createSignal("");
  const [notes, setNotes] = createSignal("");
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
    onSuccess: invalidate,
  }));
  const sync = useMutation(() => ({
    mutationFn: () => enterprise.deviceAction(params.tenantId, params.deviceId),
    onSuccess: invalidate,
  }));
  const commands = useQuery(() => ({
    queryKey: [...enterpriseKeys.item(params.tenantId, "device", params.deviceId), "commands"],
    queryFn: () => enterprise.listDeviceCommands(params.tenantId, params.deviceId),
  }));
  const activity = useQuery(() => ({
    queryKey: enterpriseKeys.deviceActivity(params.tenantId, params.deviceId, 50),
    queryFn: () => enterprise.getDeviceActivity(params.tenantId, params.deviceId, 50),
  }));
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
  const abmDevice = useQuery(() => enterpriseQueries.abmDevice(params.tenantId, abmSerial()));
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
  const resolved = () => effectivePolicy.data as EffectivePolicyResponse | undefined;
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
  const fields = () =>
    [
      ["Management name", row()?.name],
      ["Device name", row()?.physicalName],
      ["Vendor", row()?.vendor],
      ["Model", row()?.model],
      ["Model identifier", row()?.modelIdentifier],
      ["Model number", row()?.modelNumber],
      ["Serial", row()?.serial],
      ["OS", row()?.osEdition],
      ["Version", row()?.osVersion],
      ["Build", row()?.osBuild],
      ["Disk total", row()?.diskTotal],
      ["Disk used", row()?.diskUsed],
      ["Enrolled", formatDate(row()?.enrolledAt)],
      ["Last seen", formatDate(row()?.lastSeenAt)],
    ].filter(([key, value]) => !String(key).startsWith("Disk") || Boolean(value));

  const fileVaultLabel = () => {
    const status = row()?.fileVaultStatus;
    if (status === "enabled") return "Enabled";
    if (status === "disabled") return "Disabled";
    if (status === "unknown") return "Unknown";
    const value = row()?.fileVaultEnabled;
    if (value === null || value === undefined) return "Not reported";
    return value ? "Enabled" : "Disabled";
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
  const appNames = () => (applications.data?.applications ?? []) as DeviceApplication[];
  const capabilityLabels = () => {
    const value = row()?.capabilities;
    if (value == null) return [];
    if (Array.isArray(value)) return value.map((entry) => String(entry));
    if (typeof value === "string") return [value];
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
  const pushBadge = (): { label: string; tone: ChipTone } => {
    const push = health.data?.push;
    if (!push) return { label: "Unknown", tone: "muted" };
    if (push.invalidToken) return { label: "Re-enroll required", tone: "danger" };
    if (push.consecutiveFailures > 0) return { label: "Failing", tone: "warning" };
    if (push.lastSuccessAt) return { label: "Delivering", tone: "success" };
    return { label: "Not attempted", tone: "muted" };
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
  const declarationReasons = (reasons: unknown) => {
    if (reasons == null) return [];
    const values = Array.isArray(reasons) ? reasons : [reasons];
    return values
      .map((value) => {
        if (typeof value === "string") return value;
        if (value && typeof value === "object") {
          const record = value as Record<string, unknown>;
          return [record.code, record.description]
            .filter((part): part is string => typeof part === "string")
            .join(": ");
        }
        return "";
      })
      .filter(Boolean);
  };
  const certificates = () => health.data?.certificates ?? [];
  const hasActiveCertificate = () => certificates().some((certificate) => !certificate.revokedAt);
  const confirmDescription = () =>
    confirmAction() === "delete"
      ? "The device record and its history will be removed."
      : confirmAction() === "revoke"
        ? "The SCEP identity certificates issued to this device will be revoked. The device cannot renew them and may need to re-enroll."
        : "The device will be asked to remove its management profile.";
  const confirmLabel = () =>
    confirmAction() === "delete"
      ? "Delete device"
      : confirmAction() === "revoke"
        ? "Revoke identity"
        : "Unenroll device";
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
  const osLabel = () =>
    [row()?.osEdition, row()?.osVersion].filter(Boolean).join(" ") || "Not reported";
  return (
    <Page wide>
      <Show
        when={row()}
        fallback={
          <Show
            when={device.isError}
            fallback={
              <Panel>
                <div class="space-y-3">
                  <div class="h-6 w-56 animate-pulse rounded-md bg-white/[0.05]" />
                  <div class="h-4 w-80 max-w-full animate-pulse rounded-md bg-white/[0.035]" />
                  <div class="mt-6 grid gap-3 sm:grid-cols-2">
                    <div class="h-24 animate-pulse rounded-lg bg-white/[0.03]" />
                    <div class="h-24 animate-pulse rounded-lg bg-white/[0.03]" />
                  </div>
                </div>
              </Panel>
            }
          >
            <QueryError error={device.error} onRetry={() => void device.refetch()} />
          </Show>
        }
      >
        <>
          <section class="relative overflow-hidden rounded-lg border border-white/[0.08] bg-card">
            <div class="relative flex flex-col gap-4 p-4 sm:p-5 lg:flex-row lg:items-start lg:justify-between">
              <div class="flex min-w-0 items-start gap-3.5">
                <span class="flex size-9 shrink-0 items-center justify-center rounded-md border border-white/[0.09] bg-white/[0.04] text-foreground/80">
                  <DeviceGlyph proto={row()!.proto} class="size-4.5" />
                </span>
                <div class="min-w-0">
                  <a
                    href={`/t/${params.tenantId}/devices`}
                    class="mb-1 inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <ArrowLeft class="size-3" />
                    All devices
                  </a>
                  <h1 class="truncate text-[20px] font-[540] leading-tight tracking-[-0.025em] text-foreground sm:text-[22px]">
                    {row()!.name}
                  </h1>
                  <div class="mt-2 flex flex-wrap items-center gap-1.5">
                    <DeviceStatusBadge status={row()!.status} />
                    <PlatformBadge proto={row()!.proto} />
                    <DeviceHealthBadge level={health.data?.health.level ?? "unknown"} />
                  </div>
                  <div class="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-muted-foreground">
                    <span class="inline-flex min-w-0 items-baseline gap-1.5">
                      Serial
                      <span class="truncate font-mono text-[11px] text-foreground/90">
                        {row()!.serial ?? "Unknown"}
                      </span>
                    </span>
                    <span class="inline-flex min-w-0 items-baseline gap-1.5">
                      Model
                      <span class="truncate text-foreground/90">{row()!.model ?? "Unknown"}</span>
                    </span>
                    <span class="inline-flex min-w-0 items-baseline gap-1.5">
                      Asset tag
                      <span class="truncate text-foreground/90">{row()!.assetTag ?? "—"}</span>
                    </span>
                  </div>
                </div>
              </div>
              <div class="flex flex-wrap items-center gap-2 lg:justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  class="h-8"
                  onClick={() => sync.mutate()}
                  disabled={sync.isPending || row()!.status !== "enrolled"}
                >
                  {sync.isPending ? "Syncing…" : "Sync"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  class="h-8"
                  onClick={() => setConfirmAction("unenroll")}
                  disabled={unenroll.isPending || row()!.status !== "enrolled"}
                >
                  Unenroll
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  class="h-8"
                  onClick={() => setConfirmAction("delete")}
                  disabled={remove.isPending || row()!.status === "enrolled"}
                >
                  Delete
                </Button>
              </div>
            </div>
            <div class="relative grid grid-cols-2 gap-px border-t border-white/[0.06] bg-white/[0.06] sm:grid-cols-4">
              <div class="min-w-0 bg-card px-4 py-3">
                <p class="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  Enrolled
                </p>
                <p class="mt-1 truncate text-[12.5px] font-medium text-foreground">
                  {relativeTime(row()!.enrolledAt)}
                </p>
                <p class="mt-0.5 truncate text-[11px] text-muted-foreground">
                  {formatDate(row()!.enrolledAt)}
                </p>
              </div>
              <div class="min-w-0 bg-card px-4 py-3">
                <p class="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  Last seen
                </p>
                <p class="mt-1 truncate text-[12.5px] font-medium text-foreground">
                  {relativeTime(row()!.lastSeenAt)}
                </p>
                <p class="mt-0.5 truncate text-[11px] text-muted-foreground">
                  {formatDate(row()!.lastSeenAt)}
                </p>
              </div>
              <div class="min-w-0 bg-card px-4 py-3">
                <p class="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  Operating system
                </p>
                <p class="mt-1 truncate text-[12.5px] font-medium text-foreground">{osLabel()}</p>
                <p class="mt-0.5 truncate text-[11px] text-muted-foreground">
                  {row()!.osBuild ? `Build ${row()!.osBuild}` : "No build reported"}
                </p>
              </div>
              <div class="min-w-0 bg-card px-4 py-3">
                <p class="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  Asset tag
                </p>
                <p class="mt-1 truncate text-[12.5px] font-medium text-foreground">
                  {row()!.assetTag ?? "Unassigned"}
                </p>
                <p class="mt-0.5 truncate text-[11px] text-muted-foreground">
                  {row()!.modelNumber ? `Model ${row()!.modelNumber}` : "No model number"}
                </p>
              </div>
            </div>
          </section>

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
                    <Show
                      when={health.isError}
                      fallback={<p class="text-[12.5px] text-muted-foreground">Loading health…</p>}
                    >
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
                                    class={
                                      reason.severity === "critical"
                                        ? "mt-1.5 size-2 shrink-0 rounded-full bg-destructive"
                                        : reason.severity === "warning"
                                          ? "mt-1.5 size-2 shrink-0 rounded-full bg-warning"
                                          : "mt-1.5 size-2 shrink-0 rounded-full bg-muted-foreground/50"
                                    }
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
                            <span class="ml-2 normal-case tracking-normal text-muted-foreground/70">
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
                              <div class="rounded-lg border border-white/[0.07] bg-white/[0.02] p-2 text-[11.5px]">
                                <div class="flex items-center justify-between gap-2">
                                  <strong class="min-w-0 truncate font-medium">
                                    {declaration.identifier}
                                  </strong>
                                  <span class="shrink-0 text-muted-foreground">
                                    {declaration.valid} ·{" "}
                                    {declaration.active ? "active" : "inactive"}
                                  </span>
                                </div>
                                <Show when={declarationReasons(declaration.reasons).length > 0}>
                                  <ul class="mt-1 space-y-0.5 text-destructive">
                                    <For each={declarationReasons(declaration.reasons)}>
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

                    <div class="space-y-2 border-t border-white/[0.06] pt-3">
                      <div class="flex flex-wrap items-center justify-between gap-2">
                        <p class="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                          SCEP identity certificates
                        </p>
                        <Show when={certificates().length > 0}>
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
                            No device-scoped SCEP identity is recorded. Apple SCEP identities are
                            tenant-scoped and cannot be revoked per device.
                          </p>
                        }
                      >
                        <ul class="divide-y divide-white/[0.05] rounded-lg border border-white/[0.07]">
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
                      <div class="space-y-2 border-t border-white/[0.06] pt-3">
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
                            Apple rejected this device token. The device must re-enroll before it
                            can receive pushes again.
                          </p>
                        </Show>
                      </div>
                    </Show>
                  </div>
                </Show>
              </Panel>

              <Panel
                title="Security & inventory"
                description="Encryption, escrow state and the last inventory snapshot."
                actions={
                  <Show when={row()!.proto === "apple" && row()!.status === "enrolled"}>
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
                    <MetaRow label="FileVault">
                      <Chip
                        tone={
                          row()!.fileVaultStatus === "enabled"
                            ? "success"
                            : row()!.fileVaultStatus === "disabled"
                              ? "warning"
                              : "muted"
                        }
                      >
                        {fileVaultLabel()}
                      </Chip>
                    </MetaRow>
                    <MetaRow label="FileVault recovery key">
                      <span class="flex flex-wrap items-center justify-end gap-2">
                        <Chip tone={row()!.recoveryKeyEscrowed ? "success" : "warning"}>
                          {row()!.recoveryKeyEscrowed ? "Escrowed" : "Not escrowed"}
                        </Chip>
                        <Show when={row()!.recoveryKeyEscrowed}>
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
                    <MetaRow label="Model number">{row()!.modelNumber ?? "Not reported"}</MetaRow>
                    <MetaRow label="Inventory updated">
                      {formatDate(row()!.inventoryUpdatedAt)}
                    </MetaRow>
                  </dl>
                  <Show when={row()!.proto === "apple" && !row()!.recoveryKeyEscrowed}>
                    <p class="rounded-lg border border-warning/25 bg-warning/[0.07] p-3 text-[12.5px] text-warning-foreground">
                      <strong class="font-medium">No FileVault recovery key is escrowed.</strong> If
                      FileVault is enabled and the Mac is lost, the disk cannot be unlocked with a
                      Mattrax-held key. Collect security info after FileVault has been enabled on
                      the device.
                    </p>
                  </Show>
                  <Show when={row()!.proto === "apple" && !row()!.bootstrapTokenEscrowed}>
                    <p class="rounded-lg border border-warning/25 bg-warning/[0.07] p-3 text-[12.5px] text-warning-foreground">
                      <strong class="font-medium">No bootstrap token is escrowed.</strong>{" "}
                      Secure-token operations such as granting a user a Secure Token or authorising
                      some software updates may prompt for an administrator.
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
                            <span class="rounded-full border border-white/[0.07] bg-white/[0.03] px-2 py-0.5 text-[11px] text-muted-foreground">
                              {capability}
                            </span>
                          )}
                        </For>
                      </div>
                    </Show>
                  </div>
                  <Show when={!row()!.inventoryUpdatedAt}>
                    <p class="text-[11px] text-muted-foreground">
                      Security and inventory values are filled in the next time the device reports
                      its DDM status items.
                    </p>
                  </Show>
                  <ErrorText error={command.error} />
                </div>
              </Panel>

              <Panel
                title="Effective policy"
                description="Policy configurations that resolve for this device right now."
                actions={
                  <span class="text-[11px] tabular-nums text-muted-foreground">
                    {resolved()?.configurations.length ?? 0} resolved kinds
                  </span>
                }
              >
                <Show
                  when={effectivePolicy.data}
                  fallback={
                    <Show
                      when={effectivePolicy.isError}
                      fallback={
                        <p class="text-[12.5px] text-muted-foreground">Loading effective policy…</p>
                      }
                    >
                      <QueryError
                        error={effectivePolicy.error}
                        onRetry={() => void effectivePolicy.refetch()}
                      />
                    </Show>
                  }
                >
                  <div class="space-y-4">
                    <Show
                      when={(resolved()?.configurations.length ?? 0) > 0}
                      fallback={
                        <p class="text-[12.5px] text-muted-foreground">
                          No policy configurations resolve for this device. Assign an included
                          policy directly or through a group.
                        </p>
                      }
                    >
                      <ul class="divide-y divide-white/[0.05] rounded-lg border border-white/[0.07]">
                        <For each={resolved()?.configurations ?? []}>
                          {(configuration) => (
                            <li class="space-y-1 p-3 text-[12.5px]">
                              <div class="flex flex-wrap items-center justify-between gap-2">
                                <span class="font-mono text-[11px] text-muted-foreground">
                                  {configuration.kind}
                                </span>
                                <span class="flex flex-wrap items-center gap-1.5">
                                  <Chip tone="muted">
                                    {configuration.scope === "direct"
                                      ? "Direct include"
                                      : "Group include"}
                                  </Chip>
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
                                <Show when={configuration.groupNames.length > 0}>
                                  <span class="text-muted-foreground">
                                    {" "}
                                    via {configuration.groupNames.join(", ")}
                                  </span>
                                </Show>
                              </p>
                            </li>
                          )}
                        </For>
                      </ul>
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
                                    : "rounded-lg border border-white/[0.06] bg-white/[0.02] p-2 text-[11.5px] text-muted-foreground"
                                }
                              >
                                <span class="font-medium">{exclusion.policyName}</span>{" "}
                                {exclusion.scope === "direct"
                                  ? "is excluded directly"
                                  : `is excluded by ${exclusion.groupName ?? "a group"}`}
                                .{" "}
                                {exclusion.effective
                                  ? "It removed a group include."
                                  : "No include to remove."}
                              </li>
                            )}
                          </For>
                        </ul>
                      </div>
                    </Show>
                  </div>
                </Show>
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
                  <Show when={row()!.proto === "apple" && row()!.status === "enrolled"}>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={command.isPending}
                      onClick={() => command.mutate({ action: "refresh-applications" })}
                    >
                      Refresh applications
                    </Button>
                  </Show>
                }
              >
                <Show
                  when={applications.data}
                  fallback={
                    <div class="p-4 sm:p-5">
                      <Show
                        when={applications.isError}
                        fallback={
                          <p class="text-[12.5px] text-muted-foreground">Loading applications…</p>
                        }
                      >
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
                        No installed applications have been reported. Run refresh applications to
                        collect the inventory from this device.
                      </p>
                    }
                  >
                    <ul class="max-h-96 divide-y divide-white/[0.05] overflow-auto">
                      <For each={appNames()}>
                        {(application) => (
                          <li class="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-[12.5px] sm:px-5">
                            <span class="min-w-0 flex-1">
                              <span class="block truncate font-medium text-foreground">
                                {application.name ?? application.bundleId}
                              </span>
                              <span class="block truncate font-mono text-[10.5px] text-muted-foreground">
                                {application.bundleId}
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

              <Panel
                title="Device information"
                description="Management identity and the inventory reported by the client."
              >
                <dl class="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                  <For each={fields()}>
                    {([key, value]) => (
                      <div class="min-w-0 border-b border-white/[0.05] pb-2">
                        <dt class="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                          {key}
                        </dt>
                        <dd class="mt-0.5 break-words text-[12.5px] text-foreground">
                          {value || "Unknown"}
                        </dd>
                      </div>
                    )}
                  </For>
                </dl>
              </Panel>

              <Show when={row()!.proto === "apple" && row()!.serial}>
                <Panel
                  title="Apple Business Manager"
                  description="Automated Device Enrollment state for this serial."
                >
                  <div class="space-y-3 text-[12.5px]">
                    <Show
                      when={abmDevice.data}
                      fallback={
                        <p class="text-muted-foreground">
                          This serial is not in the tenant's Apple Business Manager inventory.
                          Upload an ABM credential and sync devices in Settings → Management.
                        </p>
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
                              <span class="text-[11px] text-muted-foreground">
                                {abm().deviceFamily}
                              </span>
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
                            <Show when={abm().enrollmentState !== "ASSIGNED"}>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={assignAbm.isPending}
                                onClick={() => assignAbm.mutate()}
                              >
                                {assignAbm.isPending ? "Assigning…" : "Assign to Mattrax"}
                              </Button>
                            </Show>
                            <Show when={abm().enrollmentState === "ASSIGNED"}>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={adeProfile.isPending}
                                onClick={() => adeProfile.mutate()}
                              >
                                {adeProfile.isPending ? "Creating link…" : "Get ADE profile link"}
                              </Button>
                            </Show>
                          </div>
                          <Show when={adeUrl()}>
                            {(url) => (
                              <p class="break-all rounded-lg border border-white/[0.07] bg-white/[0.02] p-2 font-mono text-[11px] text-muted-foreground">
                                {url()}
                              </p>
                            )}
                          </Show>
                          <ErrorText error={assignAbm.error ?? adeProfile.error} />
                        </>
                      )}
                    </Show>
                  </div>
                </Panel>
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
                        {autopilot().lastSyncedAt ? formatDate(autopilot().lastSyncedAt!) : "Never"}
                      </MetaRow>
                    </dl>
                    <p class="mt-3 text-[11px] text-muted-foreground">
                      Autopilot profile and enrollment state are read from Microsoft Graph. Manage
                      imports and profiles in Settings → Management.
                    </p>
                  </Panel>
                )}
              </Show>
            </div>

            <div class="min-w-0 space-y-5">
              <Show
                when={
                  (row()!.proto === "apple" ||
                    row()!.proto === "win" ||
                    row()!.proto === "android") &&
                  row()!.status === "enrolled"
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
                      <Show when={row()!.proto === "apple" || row()!.proto === "android"}>
                        <Button
                          variant="outline"
                          disabled={command.isPending}
                          onClick={() => command.mutate({ action: "lock" })}
                        >
                          Lock
                        </Button>
                      </Show>
                      <Button
                        variant="outline"
                        disabled={command.isPending}
                        onClick={() => command.mutate({ action: "restart" })}
                      >
                        Restart
                      </Button>
                      <Show when={row()!.proto === "apple"}>
                        <Button
                          variant="outline"
                          disabled={command.isPending}
                          onClick={() => command.mutate({ action: "shutdown" })}
                        >
                          Shut down
                        </Button>
                        <Button
                          variant="outline"
                          disabled={command.isPending}
                          onClick={() => command.mutate({ action: "clear-passcode" })}
                        >
                          Clear passcode
                        </Button>
                      </Show>
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
                    </div>
                    <Show when={row()!.proto === "apple"}>
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
                              command.mutate({ action: "install-app", manifestUrl: manifestUrl() })
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
                      <Show
                        when={activity.isError}
                        fallback={
                          <p class="text-[12.5px] text-muted-foreground">Loading activity…</p>
                        }
                      >
                        <QueryError
                          error={activity.error}
                          onRetry={() => void activity.refetch()}
                        />
                      </Show>
                    </div>
                  }
                >
                  <Show
                    when={(activity.data?.events.length ?? 0) > 0}
                    fallback={
                      <p class="px-4 py-6 text-[12.5px] text-muted-foreground sm:px-5">
                        No activity has been recorded for this device yet.
                      </p>
                    }
                  >
                    <ul class="max-h-[26rem] divide-y divide-white/[0.05] overflow-auto">
                      <For each={activity.data?.events ?? []}>
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
                </Show>
              </Panel>

              <Show when={(commands.data?.commands.length ?? 0) > 0}>
                <Panel
                  flush
                  title="Command history"
                  description="Remote commands sent to this device."
                >
                  <ul class="max-h-72 divide-y divide-white/[0.05] overflow-auto">
                    <For each={commands.data?.commands ?? []}>
                      {(command) => (
                        <li class="px-4 py-2.5 text-[11.5px] sm:px-5">
                          <div class="flex items-center justify-between gap-2">
                            <strong class="min-w-0 truncate font-medium text-foreground">
                              {command.requestType}
                            </strong>
                            <span class="shrink-0 capitalize text-muted-foreground">
                              {command.status}
                            </span>
                          </div>
                          <Show when={command.resultStatus || command.resultDetail}>
                            <p class="mt-1 text-muted-foreground">
                              {command.resultStatus ?? ""} {command.resultDetail ?? ""}
                            </p>
                          </Show>
                          <p class="mt-1 text-muted-foreground/70">
                            {formatDate(command.createdAt)}
                          </p>
                        </li>
                      )}
                    </For>
                  </ul>
                </Panel>
              </Show>

              <Panel title="Edit details" description="Management name, asset tag and notes.">
                <form
                  class="space-y-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    save.mutate();
                  }}
                >
                  <Field label="Name">
                    <Input value={name()} onInput={(event) => setName(event.currentTarget.value)} />
                  </Field>
                  <Field label="Asset tag">
                    <Input
                      value={assetTag()}
                      onInput={(event) => setAssetTag(event.currentTarget.value)}
                    />
                  </Field>
                  <Field label="Notes">
                    <textarea
                      class="min-h-24 rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30"
                      value={notes()}
                      onInput={(event) => setNotes(event.currentTarget.value)}
                    />
                  </Field>
                  <ErrorText error={save.error || sync.error || unenroll.error || remove.error} />
                  <Button type="submit" disabled={save.isPending}>
                    {save.isPending ? "Saving…" : "Save changes"}
                  </Button>
                </form>
              </Panel>
            </div>
          </div>
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
                  <code class="min-w-0 flex-1 break-all rounded-lg border border-white/[0.07] bg-white/[0.02] p-3 font-mono text-sm">
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
    </Page>
  );
}
