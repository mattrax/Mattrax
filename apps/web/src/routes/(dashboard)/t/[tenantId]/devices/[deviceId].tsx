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
import { enterprise, enterpriseKeys, type DeviceRow } from "~/lib/enterprise";

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
  const health = useQuery(() => ({
    queryKey: enterpriseKeys.deviceHealth(params.tenantId, params.deviceId),
    queryFn: () => enterprise.getDeviceHealth(params.tenantId, params.deviceId),
  }));
  const [manifestUrl, setManifestUrl] = createSignal("");
  const [lockPin, setLockPin] = createSignal<string | null>(null);
  const command = useMutation(() => ({
    mutationFn: (payload: {
      action: "lock" | "wipe" | "restart" | "shutdown" | "clear-passcode" | "install-app";
      manifestUrl?: string;
    }) => enterprise.deviceAction(params.tenantId, params.deviceId, payload),
    onSuccess: async (result) => {
      setLockPin(result.pin ?? null);
      await invalidate();
    },
  }));
  const unenroll = useMutation(() => ({
    mutationFn: () => enterprise.deviceUnenroll(params.tenantId, params.deviceId),
    onSuccess: invalidate,
  }));
  const revokeIdentity = useMutation(() => ({
    mutationFn: () => enterprise.revokeDeviceIdentity(params.tenantId, params.deviceId),
    onSuccess: invalidate,
  }));
  const remove = useMutation(() => ({
    mutationFn: () =>
      enterprise.deleteDevices(params.tenantId, params.deviceId ? [params.deviceId] : []),
    onSuccess: async () => {
      await invalidate();
      navigate(`/t/${params.tenantId}/devices`);
    },
  }));
  const fields = () => [
    ["Management name", row()?.name],
    ["Device name", row()?.physicalName],
    ["Vendor", row()?.vendor],
    ["Model", row()?.model],
    ["Model identifier", row()?.modelIdentifier],
    ["Serial", row()?.serial],
    ["OS", row()?.osEdition],
    ["Version", row()?.osVersion],
    ["Build", row()?.osBuild],
    ["Disk total", row()?.diskTotal],
    ["Disk used", row()?.diskUsed],
    ["Enrolled", formatDate(row()?.enrolledAt)],
    ["Last seen", formatDate(row()?.lastSeenAt)],
  ];
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
                          <span class="text-muted-foreground">
                            expires {formatDate(certificate.notAfter)}
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
            <Button variant="outline" onClick={() => setConfirmAction(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={confirmName() !== row()?.name}
              onClick={() => {
                if (confirmAction() === "delete") remove.mutate();
                else if (confirmAction() === "revoke") revokeIdentity.mutate();
                else unenroll.mutate();
                setConfirmName("");
                setConfirmAction(null);
              }}
            >
              {confirmLabel()}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
