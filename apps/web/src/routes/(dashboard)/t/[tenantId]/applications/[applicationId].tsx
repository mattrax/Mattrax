import { useNavigate, useParams } from "@solidjs/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { ErrorText, Field, LinkButton, PageHeader } from "~/components/mdm/common";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import {
  enterprise,
  enterpriseKeys,
  enterpriseQueries,
  type ApplicationNode,
  type DeviceRow,
  type GroupRow,
} from "~/lib/enterprise";
import { arrayBufferToBase64, selectFile } from "~/lib/upload-file";

export default function ApplicationDetailPage() {
  const params = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const app = useQuery(() => enterpriseQueries.application(params.tenantId, params.applicationId));
  const groups = useQuery(() => ({
    queryKey: enterpriseKeys.list(params.tenantId, "group"),
    queryFn: () => enterprise.list(params.tenantId, "group"),
  }));
  const devices = useQuery(() => ({
    queryKey: enterpriseKeys.list(params.tenantId, "device"),
    queryFn: () => enterprise.list(params.tenantId, "device"),
  }));
  const row = () => app.data as ApplicationNode | undefined;
  const [name, setName] = createSignal("");
  const [bundleId, setBundleId] = createSignal("");
  const [version, setVersion] = createSignal("");
  const [manifestUrl, setManifestUrl] = createSignal("");
  const [storeId, setStoreId] = createSignal("");
  const [notes, setNotes] = createSignal("");
  const [groupIds, setGroupIds] = createSignal<Set<string>>(new Set());
  const [deviceIds, setDeviceIds] = createSignal<Set<string>>(new Set());
  const [message, setMessage] = createSignal<string | null>(null);

  createEffect(
    () => row()?.id,
    () => {
      const value = row();
      if (!value) return;
      setName(value.name);
      setBundleId(value.bundleId ?? "");
      setVersion(value.version ?? "");
      setManifestUrl(value.manifestUrl ?? "");
      setStoreId(value.storeId ?? "");
      setNotes(value.notes ?? "");
      setGroupIds(new Set(value.groups.map((group) => group.id)));
      setDeviceIds(new Set(value.devices.map((device) => device.id)));
    },
  );

  const invalidate = async () => {
    await qc.invalidateQueries({
      queryKey: enterpriseKeys.application(params.tenantId, params.applicationId),
    });
    await qc.invalidateQueries({ queryKey: enterpriseKeys.applications(params.tenantId) });
  };

  const save = useMutation(() => ({
    mutationFn: async () => {
      await enterprise.patchApplication(params.tenantId, params.applicationId, {
        name: name(),
        bundleId: bundleId() || null,
        version: version() || null,
        manifestUrl: manifestUrl() || null,
        storeId: storeId() || null,
        notes: notes() || null,
      });
      const oldGroups = row()?.groups.map((group) => group.id) ?? [];
      const oldDevices = row()?.devices.map((device) => device.id) ?? [];
      const assignGroups = [...groupIds()].filter((id) => !oldGroups.includes(id));
      const assignDevices = [...deviceIds()].filter((id) => !oldDevices.includes(id));
      const unassignGroups = oldGroups.filter((id) => !groupIds().has(id));
      const unassignDevices = oldDevices.filter((id) => !deviceIds().has(id));
      if (
        assignGroups.length +
          assignDevices.length +
          unassignGroups.length +
          unassignDevices.length >
        0
      )
        await enterprise.patchApplicationAssignments(params.tenantId, params.applicationId, {
          assign: { groups: assignGroups, devices: assignDevices },
          unassign: { groups: unassignGroups, devices: unassignDevices },
        });
    },
    onSuccess: async () => {
      setMessage("Application and assignments saved.");
      await invalidate();
    },
  }));

  const install = useMutation(() => ({
    mutationFn: () => enterprise.installApplication(params.tenantId, params.applicationId),
    onSuccess: (result) =>
      setMessage(
        result.message ?? `Queued ${result.queued} install command(s); skipped ${result.skipped}.`,
      ),
  }));

  const upload = useMutation(() => ({
    mutationFn: async () => {
      const file = await selectFile("*/*");
      return enterprise.uploadApplication(params.tenantId, params.applicationId, {
        fileName: file.name,
        contentType: file.type || undefined,
        content: arrayBufferToBase64(await file.arrayBuffer()),
      });
    },
    onSuccess: async (result) => {
      setMessage(`Uploaded ${result.fileName} (${result.size} bytes).`);
      await invalidate();
    },
  }));

  const remove = useMutation(() => ({
    mutationFn: () => enterprise.deleteApplications(params.tenantId, [params.applicationId!]),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: enterpriseKeys.applications(params.tenantId) });
      navigate(`/t/${params.tenantId}/applications`);
    },
  }));

  const toggle = (set: () => Set<string>, update: (value: Set<string>) => void, id: string) => {
    const next = new Set(set());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    update(next);
  };

  const platform = () => row()?.platform;
  const canInstall = createMemo(() => platform() === "apple");
  const assignedCount = () => groupIds().size + deviceIds().size;

  return (
    <div class="flex flex-1 flex-col gap-6 p-6">
      <PageHeader
        title={row()?.name ?? "Application"}
        description="Catalogue metadata, assignments and delivery."
        actions={
          <>
            <LinkButton href={`/t/${params.tenantId}/applications`} variant="outline">
              Back to applications
            </LinkButton>
            <Button
              variant="outline"
              disabled={!canInstall() || install.isPending}
              title={
                canInstall()
                  ? undefined
                  : "Install is only implemented for Apple applications today."
              }
              onClick={() => install.mutate()}
            >
              {install.isPending ? "Queueing…" : "Install on assigned devices"}
            </Button>
          </>
        }
      />

      <Show
        when={row()}
        fallback={
          <div class="rounded-xl border bg-white p-6 text-sm text-stone-500">
            <Show when={app.isError} fallback={<span>Loading application…</span>}>
              <ErrorText error={app.error} />
            </Show>
          </div>
        }
      >
        {(application) => (
          <div class="grid gap-6 xl:grid-cols-[1fr_380px]">
            <div class="space-y-6">
              <Card>
                <CardHeader class="border-b">
                  <CardTitle class="text-base">Details</CardTitle>
                </CardHeader>
                <CardContent class="space-y-4">
                  <div class="flex flex-wrap items-center gap-2 text-sm">
                    <Badge variant="secondary">{application().platform}</Badge>
                    <Badge variant="secondary">{application().source}</Badge>
                    <Show when={application().sha256}>
                      {(sha) => (
                        <span class="font-mono text-xs text-stone-400">
                          sha256 {sha().slice(0, 16)}…
                        </span>
                      )}
                    </Show>
                  </div>
                  <Field label="Name">
                    <Input value={name()} onInput={(e) => setName(e.currentTarget.value)} />
                  </Field>
                  <div class="grid gap-4 sm:grid-cols-2">
                    <Field label="Bundle / package ID">
                      <Input
                        value={bundleId()}
                        onInput={(e) => setBundleId(e.currentTarget.value)}
                      />
                    </Field>
                    <Field label="Version">
                      <Input value={version()} onInput={(e) => setVersion(e.currentTarget.value)} />
                    </Field>
                    <Field label="Manifest URL">
                      <Input
                        value={manifestUrl()}
                        onInput={(e) => setManifestUrl(e.currentTarget.value)}
                      />
                    </Field>
                    <Field label="App Store ID">
                      <Input value={storeId()} onInput={(e) => setStoreId(e.currentTarget.value)} />
                    </Field>
                  </div>
                  <Field label="Notes">
                    <textarea
                      class="min-h-24 rounded-lg border bg-white px-3 py-2 text-sm"
                      value={notes()}
                      onInput={(e) => setNotes(e.currentTarget.value)}
                    />
                  </Field>
                  <div class="flex flex-wrap gap-2">
                    <Button disabled={save.isPending} onClick={() => save.mutate()}>
                      {save.isPending ? "Saving…" : "Save changes"}
                    </Button>
                    <Button
                      variant="outline"
                      disabled={upload.isPending}
                      onClick={() => upload.mutate()}
                    >
                      {upload.isPending ? "Uploading…" : "Upload file"}
                    </Button>
                    <Button
                      variant="ghost"
                      class="text-red-600 hover:text-red-700"
                      disabled={remove.isPending}
                      onClick={() => {
                        if (window.confirm(`Delete ${application().name}?`)) remove.mutate();
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                  <ErrorText error={save.error ?? upload.error ?? remove.error ?? install.error} />
                  <Show when={message()}>
                    {(text) => (
                      <p class="rounded-lg border border-stone-200 bg-stone-50 p-3 text-sm text-stone-600">
                        {text()}
                      </p>
                    )}
                  </Show>
                  <Show when={application().source === "upload"}>
                    <p class="text-xs text-stone-400">
                      Uploaded files are stored and downloadable from the API, but Apple installs
                      still need a manifest URL or store ID.
                    </p>
                  </Show>
                </CardContent>
              </Card>
            </div>

            <div class="space-y-6">
              <Card>
                <CardHeader class="border-b">
                  <CardTitle class="text-base">
                    Assignments <Badge variant="secondary">{assignedCount()}</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent class="space-y-4">
                  <div>
                    <p class="mb-2 text-sm font-medium">Groups</p>
                    <Show
                      when={(groups.data?.rows.length ?? 0) > 0}
                      fallback={<p class="text-sm text-stone-500">No groups yet.</p>}
                    >
                      <div class="max-h-48 space-y-1 overflow-auto rounded-lg border p-2">
                        <For each={groups.data?.rows ?? []}>
                          {(group: GroupRow) => (
                            <label class="flex items-center gap-2 text-sm">
                              <input
                                type="checkbox"
                                checked={groupIds().has(group.id)}
                                onChange={() => toggle(groupIds, setGroupIds, group.id)}
                              />
                              {group.name}
                            </label>
                          )}
                        </For>
                      </div>
                    </Show>
                  </div>
                  <div>
                    <p class="mb-2 text-sm font-medium">Devices</p>
                    <Show
                      when={(devices.data?.rows.length ?? 0) > 0}
                      fallback={<p class="text-sm text-stone-500">No devices enrolled yet.</p>}
                    >
                      <div class="max-h-48 space-y-1 overflow-auto rounded-lg border p-2">
                        <For each={devices.data?.rows ?? []}>
                          {(device: DeviceRow) => (
                            <label class="flex items-center gap-2 text-sm">
                              <input
                                type="checkbox"
                                checked={deviceIds().has(device.id)}
                                onChange={() => toggle(deviceIds, setDeviceIds, device.id)}
                              />
                              {device.name}{" "}
                              <span class="text-xs text-stone-400">{device.proto}</span>
                            </label>
                          )}
                        </For>
                      </div>
                    </Show>
                  </div>
                  <p class="text-xs text-stone-400">
                    Assignments are saved with the form above. Apple installs are queued on the next
                    check-in; Windows and Android delivery is not implemented yet.
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        )}
      </Show>
    </div>
  );
}
