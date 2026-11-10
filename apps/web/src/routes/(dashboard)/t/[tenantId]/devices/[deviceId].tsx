import { useNavigate, useParams } from "@solidjs/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { createEffect, createSignal, For, Show } from "solid-js";
import {
  DeviceHealthBadge,
  DeviceStatusBadge,
  ErrorText,
  Field,
  formatDate,
  PageHeader,
  PlatformBadge,
  QueryError,
} from "~/components/mdm/common";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
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
  enterprise,
  enterpriseKeys,
  enterpriseQueries,
  type DeviceApplication,
  type DeviceRow,
  type EffectivePolicyResponse,
} from "~/lib/enterprise";

export default function DeviceDetailPage() {
  const params = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const device = useQuery(() => ({
    queryKey: enterpriseKeys.item(params.tenantId, "device", params.deviceId),
    queryFn: () => enterprise.get(params.tenantId, "device", params.deviceId),
  }));
  const row = () => device.data as DeviceRow | undefined;
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
  const certificateExpiryClass = (notAfter: string, revoked: boolean) => {
    if (revoked) return "rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-red-700";
    const days = certificateDays(notAfter);
    if (days === null) return "rounded-full border border-stone-200 bg-stone-50 px-2 py-0.5";
    if (days <= 0) return "rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-red-700";
    if (days <= 7) return "rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-red-700";
    if (days <= 30)
      return "rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-amber-800";
    return "rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-green-700";
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
  const activityBadgeClass = (kind: string) => {
    switch (kind) {
      case "audit":
        return "border-violet-200 bg-violet-50 text-violet-700";
      case "command":
        return "border-sky-200 bg-sky-50 text-sky-700";
      case "declaration":
        return "border-amber-200 bg-amber-50 text-amber-800";
      case "certificate":
        return "border-emerald-200 bg-emerald-50 text-emerald-700";
      default:
        return "border-stone-200 bg-stone-50 text-stone-600";
    }
  };
  const pushBadge = () => {
    const push = health.data?.push;
    if (!push) return { label: "Unknown", class: "border-stone-200 bg-stone-50 text-stone-600" };
    if (push.invalidToken)
      return { label: "Re-enroll required", class: "border-red-200 bg-red-50 text-red-700" };
    if (push.consecutiveFailures > 0)
      return { label: "Failing", class: "border-amber-200 bg-amber-50 text-amber-800" };
    if (push.lastSuccessAt)
      return { label: "Delivering", class: "border-green-200 bg-green-50 text-green-700" };
    return { label: "Not attempted", class: "border-stone-200 bg-stone-50 text-stone-600" };
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
  return (
    <div class="flex flex-1 flex-col gap-6 p-6">
      <PageHeader
        title={row()?.name ?? "Device"}
        description="Device inventory and management actions."
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => sync.mutate()}
              disabled={sync.isPending || row()?.status !== "enrolled"}
            >
              Sync
            </Button>
            <Button
              variant="outline"
              onClick={() => setConfirmAction("unenroll")}
              disabled={unenroll.isPending || row()?.status !== "enrolled"}
            >
              Unenroll
            </Button>
            <Button
              variant="destructive"
              onClick={() => setConfirmAction("delete")}
              disabled={remove.isPending || row()?.status === "enrolled"}
            >
              Delete
            </Button>
          </>
        }
      />
      <Show
        when={row()}
        fallback={
          <Show
            when={device.isError}
            fallback={
              <Card>
                <CardContent>Loading device...</CardContent>
              </Card>
            }
          >
            <QueryError error={device.error} onRetry={() => void device.refetch()} />
          </Show>
        }
      >
        <Card>
          <CardHeader>
            <div class="flex flex-wrap items-center justify-between gap-2">
              <CardTitle>Device health</CardTitle>
              <DeviceHealthBadge level={health.data?.health.level ?? "unknown"} />
            </div>
          </CardHeader>
          <CardContent class="space-y-4">
            <Show
              when={health.data}
              fallback={
                <Show
                  when={health.isError}
                  fallback={<p class="text-sm text-muted-foreground">Loading health…</p>}
                >
                  <QueryError error={health.error} onRetry={() => void health.refetch()} />
                </Show>
              }
            >
              <div class="grid gap-4 lg:grid-cols-2">
                <div class="space-y-2">
                  <p class="text-sm text-muted-foreground">
                    Last seen {formatDate(health.data!.health.lastSeenAt)}
                    <Show when={health.data!.health.stale}>
                      <span class="ml-2 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs text-amber-800">
                        Stale
                      </span>
                    </Show>
                  </p>
                  <Show
                    when={health.data!.health.reasons.length > 0}
                    fallback={
                      <p class="text-sm text-green-700">
                        No compliance or inventory issues detected.
                      </p>
                    }
                  >
                    <ul class="space-y-1.5">
                      <For each={health.data!.health.reasons}>
                        {(reason) => (
                          <li class="flex items-start gap-2 text-sm">
                            <span
                              class={
                                reason.severity === "critical"
                                  ? "mt-1.5 size-2 shrink-0 rounded-full bg-red-500"
                                  : reason.severity === "warning"
                                    ? "mt-1.5 size-2 shrink-0 rounded-full bg-amber-500"
                                    : "mt-1.5 size-2 shrink-0 rounded-full bg-stone-400"
                              }
                              aria-hidden="true"
                            />
                            <span class={reason.severity === "critical" ? "text-red-700" : ""}>
                              {reason.label}
                            </span>
                          </li>
                        )}
                      </For>
                    </ul>
                  </Show>
                </div>
                <div class="space-y-2">
                  <p class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Failing declarations
                    <Show when={(health.data?.declarations.length ?? 0) > 0}>
                      <span class="ml-2 normal-case tracking-normal text-stone-500">
                        {declarationIssues().length} of {health.data?.declarations.length}
                      </span>
                    </Show>
                  </p>
                  <Show
                    when={declarationIssues().length > 0}
                    fallback={<p class="text-sm text-muted-foreground">No failing declarations.</p>}
                  >
                    <For each={declarationIssues()}>
                      {(declaration) => (
                        <div class="rounded-lg border p-2 text-xs">
                          <div class="flex items-center justify-between gap-2">
                            <strong class="min-w-0 truncate">{declaration.identifier}</strong>
                            <span class="shrink-0 text-muted-foreground">
                              {declaration.valid} · {declaration.active ? "active" : "inactive"}
                            </span>
                          </div>
                          <Show when={declarationReasons(declaration.reasons).length > 0}>
                            <ul class="mt-1 space-y-1 text-red-700">
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
              <div class="space-y-2 border-t pt-3">
                <div class="flex items-center justify-between gap-2">
                  <p class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
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
                    <p class="text-sm text-muted-foreground">
                      No device-scoped SCEP identity is recorded. Apple SCEP identities are
                      tenant-scoped and cannot be revoked per device.
                    </p>
                  }
                >
                  <ul class="divide-y rounded-lg border">
                    <For each={certificates()}>
                      {(certificate) => (
                        <li class="flex flex-wrap items-center justify-between gap-2 p-2 text-xs">
                          <span class="font-mono">{certificate.serial}</span>
                          <span class="flex items-center gap-2">
                            <span class="text-muted-foreground">
                              expires {formatDate(certificate.notAfter)}
                            </span>
                            <span
                              class={certificateExpiryClass(
                                certificate.notAfter,
                                Boolean(certificate.revokedAt),
                              )}
                            >
                              {certificate.revokedAt
                                ? "revoked"
                                : certificateDaysLabel(certificate.notAfter)}
                            </span>
                          </span>
                          <span
                            class={
                              certificate.revokedAt
                                ? "rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-red-700"
                                : "rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-green-700"
                            }
                          >
                            {certificate.revokedAt
                              ? `revoked ${formatDate(certificate.revokedAt)}`
                              : "active"}
                          </span>
                        </li>
                      )}
                    </For>
                  </ul>
                </Show>
              </div>
              <Show when={row()?.proto === "apple" && health.data?.push}>
                <div class="space-y-2 border-t pt-3">
                  <div class="flex items-center justify-between gap-2">
                    <p class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      APNs push delivery
                    </p>
                    <span class={`rounded-full border px-2 py-0.5 text-xs ${pushBadge().class}`}>
                      {pushBadge().label}
                    </span>
                  </div>
                  <dl class="grid gap-2 text-sm sm:grid-cols-2">
                    <div class="flex items-center justify-between gap-2 border-b pb-1.5">
                      <dt class="text-muted-foreground">Last attempt</dt>
                      <dd>{relativeTime(health.data!.push.lastAttemptAt)}</dd>
                    </div>
                    <div class="flex items-center justify-between gap-2 border-b pb-1.5">
                      <dt class="text-muted-foreground">Last success</dt>
                      <dd>{relativeTime(health.data!.push.lastSuccessAt)}</dd>
                    </div>
                    <div class="flex items-center justify-between gap-2 border-b pb-1.5">
                      <dt class="text-muted-foreground">Consecutive failures</dt>
                      <dd>{health.data!.push.consecutiveFailures}</dd>
                    </div>
                    <div class="flex items-center justify-between gap-2 border-b pb-1.5">
                      <dt class="text-muted-foreground">Push credentials</dt>
                      <dd>{health.data!.push.configured ? "Present" : "Missing"}</dd>
                    </div>
                  </dl>
                  <Show when={health.data!.push.lastError}>
                    <p class="rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">
                      {health.data!.push.lastError}
                    </p>
                  </Show>
                  <Show when={health.data!.push.invalidToken}>
                    <p class="text-xs text-red-700">
                      Apple rejected this device token. The device must re-enroll before it can
                      receive pushes again.
                    </p>
                  </Show>
                </div>
              </Show>
            </Show>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div class="flex flex-wrap items-center justify-between gap-2">
              <CardTitle>Security & inventory</CardTitle>
              <Show when={row()?.proto === "apple" && row()?.status === "enrolled"}>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={command.isPending}
                  onClick={() => command.mutate({ action: "collect-security-info" })}
                >
                  Collect security info
                </Button>
              </Show>
            </div>
          </CardHeader>
          <CardContent class="space-y-4">
            <dl class="grid gap-3 text-sm sm:grid-cols-2">
              <div class="flex items-center justify-between gap-2 border-b pb-2">
                <dt class="text-muted-foreground">FileVault</dt>
                <dd>
                  <span
                    class={
                      row()?.fileVaultStatus === "enabled"
                        ? "rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-xs text-green-700"
                        : row()?.fileVaultStatus === "disabled"
                          ? "rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs text-amber-800"
                          : "rounded-full border border-stone-200 bg-stone-50 px-2 py-0.5 text-xs text-stone-600"
                    }
                  >
                    {fileVaultLabel()}
                  </span>
                </dd>
              </div>
              <div class="flex items-center justify-between gap-2 border-b pb-2">
                <dt class="text-muted-foreground">FileVault recovery key</dt>
                <dd class="flex items-center gap-2">
                  <span
                    class={
                      row()?.recoveryKeyEscrowed
                        ? "rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-xs text-green-700"
                        : "rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs text-amber-800"
                    }
                  >
                    {row()?.recoveryKeyEscrowed ? "Escrowed" : "Not escrowed"}
                  </span>
                  <Show when={row()?.recoveryKeyEscrowed}>
                    <Button variant="outline" size="sm" onClick={openRecoveryDialog}>
                      Reveal
                    </Button>
                  </Show>
                </dd>
              </div>
              <div class="flex items-center justify-between gap-2 border-b pb-2">
                <dt class="text-muted-foreground">Bootstrap token</dt>
                <dd>
                  <span
                    class={
                      row()?.bootstrapTokenEscrowed
                        ? "rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-xs text-green-700"
                        : "rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs text-amber-800"
                    }
                  >
                    {row()?.bootstrapTokenEscrowed ? "Escrowed" : "Not escrowed"}
                  </span>
                </dd>
              </div>
              <div class="flex items-center justify-between gap-2 border-b pb-2">
                <dt class="text-muted-foreground">Recovery key updated</dt>
                <dd>{formatDate(row()?.recoveryKeyUpdatedAt)}</dd>
              </div>
              <div class="flex items-center justify-between gap-2 border-b pb-2">
                <dt class="text-muted-foreground">Battery health</dt>
                <dd>{row()?.batteryHealth ?? "Not reported"}</dd>
              </div>
              <div class="flex items-center justify-between gap-2 border-b pb-2">
                <dt class="text-muted-foreground">Model number</dt>
                <dd>{row()?.modelNumber ?? "Not reported"}</dd>
              </div>
              <div class="flex items-center justify-between gap-2 border-b pb-2">
                <dt class="text-muted-foreground">Inventory updated</dt>
                <dd>{formatDate(row()?.inventoryUpdatedAt)}</dd>
              </div>
            </dl>
            <Show when={row()?.proto === "apple" && !row()?.recoveryKeyEscrowed}>
              <p class="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                <strong>No FileVault recovery key is escrowed.</strong> If FileVault is enabled and
                the Mac is lost, the disk cannot be unlocked with a Mattrax-held key. Collect
                security info after FileVault has been enabled on the device.
              </p>
            </Show>
            <Show when={row()?.proto === "apple" && !row()?.bootstrapTokenEscrowed}>
              <p class="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                <strong>No bootstrap token is escrowed.</strong> Secure-token operations such as
                granting a user a Secure Token or authorising some software updates may prompt for
                an administrator.
              </p>
            </Show>
            <div>
              <p class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Client capabilities
              </p>
              <Show
                when={capabilityLabels().length > 0}
                fallback={
                  <p class="mt-1 text-sm text-muted-foreground">
                    No capabilities have been reported yet.
                  </p>
                }
              >
                <div class="mt-2 flex max-h-40 flex-wrap gap-1.5 overflow-auto">
                  <For each={capabilityLabels()}>
                    {(capability) => (
                      <span class="rounded-full border bg-muted/40 px-2 py-0.5 text-xs">
                        {capability}
                      </span>
                    )}
                  </For>
                </div>
              </Show>
            </div>
            <Show when={!row()?.inventoryUpdatedAt}>
              <p class="text-xs text-muted-foreground">
                Security and inventory values are filled in the next time the device reports its DDM
                status items.
              </p>
            </Show>
            <ErrorText error={command.error} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div class="flex flex-wrap items-center justify-between gap-2">
              <CardTitle>Software</CardTitle>
              <Show when={row()?.proto === "apple" && row()?.status === "enrolled"}>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={command.isPending}
                  onClick={() => command.mutate({ action: "refresh-applications" })}
                >
                  Refresh applications
                </Button>
              </Show>
            </div>
          </CardHeader>
          <CardContent class="space-y-3">
            <Show
              when={applications.data}
              fallback={
                <Show
                  when={applications.isError}
                  fallback={<p class="text-sm text-muted-foreground">Loading software…</p>}
                >
                  <QueryError
                    error={applications.error}
                    onRetry={() => void applications.refetch()}
                  />
                </Show>
              }
            >
              <Show
                when={appNames().length > 0}
                fallback={
                  <p class="text-sm text-muted-foreground">
                    No installed applications have been reported. Run refresh applications to
                    collect the inventory from this device.
                  </p>
                }
              >
                <p class="text-xs text-muted-foreground">
                  {appNames().length} applications reported · updated{" "}
                  {formatDate(row()?.applicationsUpdatedAt)}
                </p>
                <ul class="max-h-96 divide-y overflow-auto rounded-lg border">
                  <For each={appNames()}>
                    {(application) => (
                      <li class="flex flex-wrap items-center justify-between gap-2 p-2 text-sm">
                        <span class="min-w-0">
                          <span class="block truncate font-medium">
                            {application.name ?? application.bundleId}
                          </span>
                          <span class="block truncate font-mono text-xs text-muted-foreground">
                            {application.bundleId}
                          </span>
                        </span>
                        <span class="flex shrink-0 flex-wrap items-center gap-1.5 text-xs">
                          <span class="text-muted-foreground">
                            {application.version ?? application.shortVersion ?? "—"}
                          </span>
                          <span class="text-muted-foreground">
                            {formatBytes(application.bundleSize)}
                          </span>
                          <Show when={application.isManaged}>
                            <span class="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-sky-700">
                              Managed
                            </span>
                          </Show>
                          <Show when={application.hasUpdateAvailable}>
                            <span class="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-amber-800">
                              Update available
                            </span>
                          </Show>
                        </span>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
            </Show>
          </CardContent>
        </Card>
        <div class="grid gap-6 lg:grid-cols-[1fr_360px]">
          <Card>
            <CardHeader>
              <CardTitle>Overview</CardTitle>
            </CardHeader>
            <CardContent>
              <div class="mb-4 flex gap-2">
                <DeviceStatusBadge status={row()!.status} />
                <PlatformBadge proto={row()!.proto} />
              </div>
              <dl class="grid gap-3 text-sm">
                <For each={fields()}>
                  {([key, value]) => (
                    <div class="grid grid-cols-[160px_1fr] gap-4 border-b pb-2 last:border-0">
                      <dt class="text-muted-foreground">{key}</dt>
                      <dd>{value || "Unknown"}</dd>
                    </div>
                  )}
                </For>
              </dl>
            </CardContent>
          </Card>
          <Card class="lg:col-span-2">
            <CardHeader>
              <div class="flex items-center justify-between gap-2">
                <CardTitle>Effective policy</CardTitle>
                <span class="text-xs text-muted-foreground">
                  {resolved()?.configurations.length ?? 0} resolved kinds
                </span>
              </div>
            </CardHeader>
            <CardContent class="space-y-4">
              <Show
                when={effectivePolicy.data}
                fallback={
                  <Show
                    when={effectivePolicy.isError}
                    fallback={
                      <p class="text-sm text-muted-foreground">Loading effective policy…</p>
                    }
                  >
                    <QueryError
                      error={effectivePolicy.error}
                      onRetry={() => void effectivePolicy.refetch()}
                    />
                  </Show>
                }
              >
                <Show
                  when={(resolved()?.configurations.length ?? 0) > 0}
                  fallback={
                    <p class="text-sm text-muted-foreground">
                      No policy configurations resolve for this device. Assign an included policy
                      directly or through a group.
                    </p>
                  }
                >
                  <ul class="divide-y rounded-lg border">
                    <For each={resolved()?.configurations ?? []}>
                      {(configuration) => (
                        <li class="space-y-1 p-3 text-sm">
                          <div class="flex flex-wrap items-center justify-between gap-2">
                            <span class="font-mono text-xs">{configuration.kind}</span>
                            <span class="flex items-center gap-1.5">
                              <span class="rounded-full border bg-muted/40 px-2 py-0.5 text-xs">
                                {configuration.scope === "direct"
                                  ? "Direct include"
                                  : "Group include"}
                              </span>
                              <span class="rounded-full border bg-muted/40 px-2 py-0.5 text-xs">
                                priority {configuration.priority}
                              </span>
                            </span>
                          </div>
                          <p>
                            <a
                              class="font-medium hover:underline"
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
                    <p class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Overridden policies
                    </p>
                    <ul class="mt-2 space-y-1">
                      <For each={resolved()?.overridden ?? []}>
                        {(override) => (
                          <li class="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
                            <span class="font-medium">{override.policyName}</span> ({override.kind})
                            lost to {override.reason.replaceAll("-", " ")}.
                          </li>
                        )}
                      </For>
                    </ul>
                  </div>
                </Show>
                <Show when={(resolved()?.exclusions.length ?? 0) > 0}>
                  <div>
                    <p class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Exclusions
                    </p>
                    <ul class="mt-2 space-y-1">
                      <For each={resolved()?.exclusions ?? []}>
                        {(exclusion) => (
                          <li
                            class={
                              exclusion.effective
                                ? "rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-800"
                                : "rounded-lg border bg-muted/20 p-2 text-xs text-muted-foreground"
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
              </Show>
            </CardContent>
          </Card>
          <Show
            when={
              (row()?.proto === "apple" || row()?.proto === "win") && row()?.status === "enrolled"
            }
          >
            <Card>
              <CardHeader>
                <CardTitle>Remote actions</CardTitle>
              </CardHeader>
              <CardContent class="space-y-3">
                <p class="text-sm text-muted-foreground">
                  Commands are queued and delivered on the device's next check-in.
                </p>
                <div class="grid grid-cols-2 gap-2">
                  <Show when={row()?.proto === "apple"}>
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
                  <Show when={row()?.proto === "apple"}>
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
                <Show when={row()?.proto === "apple"}>
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
                    <p class="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                      Device lock PIN: <strong class="font-mono">{pin()}</strong>
                    </p>
                  )}
                </Show>
                <ErrorText error={command.error} />
              </CardContent>
            </Card>
          </Show>
          <Show when={(commands.data?.commands.length ?? 0) > 0}>
            <Card>
              <CardHeader>
                <CardTitle>Command history</CardTitle>
              </CardHeader>
              <CardContent class="space-y-2">
                <For each={commands.data?.commands ?? []}>
                  {(command) => (
                    <div class="rounded-lg border p-2 text-xs">
                      <div class="flex items-center justify-between gap-2">
                        <strong>{command.requestType}</strong>
                        <span class="capitalize text-muted-foreground">{command.status}</span>
                      </div>
                      <Show when={command.resultStatus || command.resultDetail}>
                        <p class="mt-1 text-muted-foreground">
                          {command.resultStatus ?? ""} {command.resultDetail ?? ""}
                        </p>
                      </Show>
                      <p class="mt-1 text-muted-foreground">{formatDate(command.createdAt)}</p>
                    </div>
                  )}
                </For>
              </CardContent>
            </Card>
          </Show>
          <Card>
            <CardHeader>
              <div class="flex items-center justify-between gap-2">
                <CardTitle>Activity</CardTitle>
                <span class="text-xs text-muted-foreground">Newest first</span>
              </div>
            </CardHeader>
            <CardContent class="space-y-2">
              <Show
                when={activity.data}
                fallback={
                  <Show
                    when={activity.isError}
                    fallback={<p class="text-sm text-muted-foreground">Loading activity…</p>}
                  >
                    <QueryError error={activity.error} onRetry={() => void activity.refetch()} />
                  </Show>
                }
              >
                <Show
                  when={(activity.data?.events.length ?? 0) > 0}
                  fallback={
                    <p class="text-sm text-muted-foreground">
                      No activity has been recorded for this device yet.
                    </p>
                  }
                >
                  <ul class="space-y-2">
                    <For each={activity.data?.events ?? []}>
                      {(event) => (
                        <li class="rounded-lg border p-2 text-xs">
                          <div class="flex items-center justify-between gap-2">
                            <span class="flex min-w-0 items-center gap-1.5">
                              <span
                                class={`shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${activityBadgeClass(event.kind)}`}
                              >
                                {event.kind}
                              </span>
                              <strong class="truncate">{event.title}</strong>
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
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Edit details</CardTitle>
            </CardHeader>
            <CardContent>
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
                    class="min-h-28 rounded-lg border bg-white px-3 py-2 text-sm"
                    value={notes()}
                    onInput={(event) => setNotes(event.currentTarget.value)}
                  />
                </Field>
                <ErrorText error={save.error || sync.error || unenroll.error || remove.error} />
                <Button type="submit" disabled={save.isPending}>
                  Save changes
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </Show>

      <Dialog
        open={confirmAction() !== null}
        onOpenChange={(open) => !open && setConfirmAction(null)}
      >
        <DialogContent class="max-w-md rounded-xl bg-white p-6">
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
        <DialogContent class="max-w-lg rounded-xl bg-white p-6">
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
                  <code class="min-w-0 flex-1 break-all rounded-lg border bg-muted/40 p-3 font-mono text-sm">
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
    </div>
  );
}
