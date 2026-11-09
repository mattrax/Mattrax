import { useNavigate, useParams } from "@solidjs/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { createEffect, createSignal, For, Show } from "solid-js";
import {
  DeviceStatusBadge,
  ErrorText,
  Field,
  formatDate,
  PageHeader,
  PlatformBadge,
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
  const [confirmAction, setConfirmAction] = createSignal<"unenroll" | "delete" | null>(null);
  const [confirmName, setConfirmName] = createSignal("");
  createEffect(
    () => row(),
    (row) => {
      if (row) {
        setName(row.name);
        setAssetTag(row.assetTag ?? "");
        setNotes(row.notes ?? "");
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
  const [manifestUrl, setManifestUrl] = createSignal("");
  const command = useMutation(() => ({
    mutationFn: (payload: {
      action: "lock" | "wipe" | "restart" | "shutdown" | "clear-passcode" | "install-app";
      manifestUrl?: string;
    }) => enterprise.deviceAction(params.tenantId, params.deviceId, payload),
    onSuccess: invalidate,
  }));
  const unenroll = useMutation(() => ({
    mutationFn: () => enterprise.deviceUnenroll(params.tenantId, params.deviceId),
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
          <Card>
            <CardContent>Loading device...</CardContent>
          </Card>
        }
      >
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
                <ErrorText error={command.error} />
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
            <DialogTitle>
              {confirmAction() === "delete" ? "Delete device" : "Unenroll device"}?
            </DialogTitle>
            <DialogDescription>
              {confirmAction() === "delete"
                ? "The device record and its history will be removed."
                : "The device will be asked to remove its management profile."}
            </DialogDescription>
          </DialogHeader>
          <p class="text-sm text-muted-foreground">
            Type <span class="font-mono font-medium">{row()?.name}</span> to confirm.
          </p>
          <Input value={confirmName()} onInput={(e) => setConfirmName(e.currentTarget.value)} />
          <ErrorText error={unenroll.error || remove.error} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmAction(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={confirmName() !== row()?.name}
              onClick={() => {
                if (confirmAction() === "delete") remove.mutate();
                else unenroll.mutate();
                setConfirmName("");
                setConfirmAction(null);
              }}
            >
              {confirmAction() === "delete" ? "Delete device" : "Unenroll device"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
