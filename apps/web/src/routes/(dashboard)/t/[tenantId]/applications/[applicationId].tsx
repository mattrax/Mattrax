import { useNavigate, useParams } from "@solidjs/router";
import { Match, Option, Schema } from "effect";
import { ApplicationNode } from "@mattrax/enterprise-domain/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import {
  ErrorText,
  Field,
  LinkButton,
  Page,
  PageHeader,
  Panel,
  PlatformBadge,
  QueryError,
} from "~/components/mdm/common";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import { Input } from "~/components/ui/input";
import { CircleAlert } from "~/components/ui/icons";
import {
  enterprise,
  enterpriseKeys,
  enterpriseQueries,
  type DeviceRow,
  type GroupRow,
} from "~/lib/enterprise";
import { arrayBufferToBase64, selectFile } from "~/lib/upload-file";
import { ReadOnlyNotice, useCan } from "~/lib/permissions";

const textareaClass =
  "min-h-24 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30";

const sourceLabel = (source: ApplicationNode["source"]) =>
  Match.value(source).pipe(
    Match.when("manifest", () => "Manifest URL"),
    Match.when("store", () => "App Store"),
    Match.orElse(() => "Uploaded file"),
  );

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

export default function ApplicationDetailPage() {
  const params = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { can } = useCan();
  const writable = () => can("applications.write");
  const app = useQuery(() => enterpriseQueries.application(params.tenantId, params.applicationId));

  const groups = useQuery(() => ({
    queryKey: enterpriseKeys.list(params.tenantId, "group"),
    queryFn: () => enterprise.list(params.tenantId, "group"),
  }));

  const devices = useQuery(() => ({
    queryKey: enterpriseKeys.list(params.tenantId, "device"),
    queryFn: () => enterprise.list(params.tenantId, "device"),
  }));

  const vpp = useQuery(() => enterpriseQueries.vpp(params.tenantId));
  const vppAssets = useQuery(() => enterpriseQueries.vppAssets(params.tenantId));

  const row = () => Option.getOrUndefined(Schema.decodeUnknownOption(ApplicationNode)(app.data));

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

  const [installNotice, setInstallNotice] = createSignal<
    { tone: "success" | "warning"; text: string } | undefined
  >();

  const install = useMutation(() => ({
    mutationFn: () => enterprise.installApplication(params.tenantId, params.applicationId),
    onMutate: () => setInstallNotice(undefined),
    // Nothing queued is not a success: report why instead of showing a green
    // panel that looks like the install worked.
    onSuccess: (result) =>
      setInstallNotice(
        result.queued > 0
          ? {
              tone: "success",
              text:
                result.message ??
                `Queued ${result.queued} install command(s); skipped ${result.skipped}.`,
            }
          : {
              tone: "warning",
              text:
                result.message ??
                "No devices were eligible. Assign this application to a device or group first.",
            },
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

  const [confirmDelete, setConfirmDelete] = createSignal(false);

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

  const vppAsset = createMemo(() =>
    (vppAssets.data?.assets ?? []).find((asset) => asset.adamId === storeId()),
  );

  return (
    <Page>
      <PageHeader
        eyebrow="Application"
        title={row()?.name ?? "Application"}
        description="Catalogue metadata, assignments and delivery."
        meta={
          <Show when={row()}>
            <PlatformBadge proto={row()!.platform} />
            <Badge variant="outline" class="text-muted-foreground">
              {sourceLabel(row()!.source)}
            </Badge>
            <Show when={row()?.version}>
              <span class="font-mono text-[11.5px] text-muted-foreground">v{row()!.version}</span>
            </Show>
            <Show when={row()?.bundleId}>
              <span class="max-w-[24ch] truncate font-mono text-[11.5px] text-muted-foreground">
                {row()!.bundleId}
              </span>
            </Show>
          </Show>
        }
        actions={
          <>
            <LinkButton href={`/t/${params.tenantId}/applications`} variant="outline">
              Back to applications
            </LinkButton>
            <Show when={writable()}>
              <Button
                variant="outline"
                disabled={!canInstall() || install.isPending || assignedCount() === 0}
                title={
                  !canInstall()
                    ? "Install is only implemented for Apple applications today."
                    : assignedCount() === 0
                      ? "Assign this application to a device or group first."
                      : undefined
                }
                onClick={() => install.mutate()}
              >
                {install.isPending
                  ? "Queueing…"
                  : vppAsset()
                    ? "Install via VPP on assigned devices"
                    : "Install on assigned devices"}
              </Button>
            </Show>
          </>
        }
      />

      <Show
        when={row()}
        fallback={
          <Panel>
            <Show
              when={app.isError}
              fallback={
                <div class="space-y-2">
                  <div class="h-4 w-48 animate-pulse rounded bg-muted/60" />
                  <div class="h-28 animate-pulse rounded-lg bg-muted/40" />
                </div>
              }
            >
              <ErrorText error={app.error} />
            </Show>
          </Panel>
        }
      >
        {(application) => (
          <div class="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px] xl:items-start">
            <div class="space-y-5">
              <Panel
                title="Details"
                description="Metadata, installer source and the upload attached to this app."
              >
                <div class="space-y-4">
                  <Show when={!writable()}>
                    <ReadOnlyNotice>
                      Your role can view this application but not change it.
                    </ReadOnlyNotice>
                  </Show>
                  <div class="flex flex-wrap items-center gap-2 text-[12px]">
                    <PlatformBadge proto={application().platform} />
                    <Badge variant="outline" class="text-muted-foreground">
                      {sourceLabel(application().source)}
                    </Badge>
                    <Show when={application().sha256}>
                      {(sha) => (
                        <span class="truncate font-mono text-[11px] text-muted-foreground">
                          sha256 {sha().slice(0, 16)}…
                        </span>
                      )}
                    </Show>
                    <Show when={application().size}>
                      <span class="text-[11px] tabular-nums text-muted-foreground">
                        {formatBytes(application().size)}
                      </span>
                    </Show>
                  </div>

                  <QueryError error={vpp.error} onRetry={() => void vpp.refetch()} />
                  <QueryError error={vppAssets.error} onRetry={() => void vppAssets.refetch()} />

                  <Show when={vppAsset()}>
                    {(asset) => (
                      <div class="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3">
                        <div class="flex flex-wrap items-center gap-2">
                          <Badge class="text-[10px]">VPP</Badge>
                          <span class="text-[13px] font-medium text-foreground">
                            {asset().name}
                          </span>
                          <Show when={asset().bundleId}>
                            <span class="font-mono text-[11px] text-muted-foreground">
                              {asset().bundleId}
                            </span>
                          </Show>
                        </div>
                        <p class="mt-1 text-[11.5px] text-muted-foreground">
                          {asset().availableLicenses} of {asset().totalLicenses} licence
                          {asset().totalLicenses === 1 ? "" : "s"} available ·{" "}
                          {asset().assignedLicenses} assigned
                        </p>
                        <Show when={asset().availableLicenses === 0}>
                          <p class="mt-1 text-[11.5px] text-warning-foreground">
                            No licences are available. Installs will be skipped until a licence is
                            returned or purchased.
                          </p>
                        </Show>
                      </div>
                    )}
                  </Show>

                  <Show when={vpp.data?.configured && vppAssets.data && !vppAsset()}>
                    <p class="flex items-start gap-2 rounded-lg border border-warning/25 bg-warning/[0.07] p-3 text-[11.5px] leading-relaxed text-warning-foreground">
                      <CircleAlert class="mt-0.5 size-3.5 shrink-0" />
                      <span>
                        Apps and Books is configured, but no licence pool exists for this App Store
                        ID. Sync Apps and Books from Settings → Management before installing.
                      </span>
                    </p>
                  </Show>

                  <Field label="Name">
                    <Input
                      disabled={!writable()}
                      value={name()}
                      onInput={(e) => setName(e.currentTarget.value)}
                    />
                  </Field>
                  <div class="grid gap-4 sm:grid-cols-2">
                    <Field label="Bundle / package ID">
                      <Input
                        disabled={!writable()}
                        value={bundleId()}
                        onInput={(e) => setBundleId(e.currentTarget.value)}
                      />
                    </Field>
                    <Field label="Version">
                      <Input
                        disabled={!writable()}
                        value={version()}
                        onInput={(e) => setVersion(e.currentTarget.value)}
                      />
                    </Field>
                    <Field label="Manifest URL">
                      <Input
                        disabled={!writable()}
                        value={manifestUrl()}
                        onInput={(e) => setManifestUrl(e.currentTarget.value)}
                      />
                    </Field>
                    <Field label="App Store ID">
                      <Input
                        disabled={!writable()}
                        value={storeId()}
                        onInput={(e) => setStoreId(e.currentTarget.value)}
                      />
                    </Field>
                  </div>
                  <Field label="Notes">
                    <textarea
                      disabled={!writable()}
                      class={textareaClass}
                      value={notes()}
                      onInput={(e) => setNotes(e.currentTarget.value)}
                    />
                  </Field>
                  <div class="flex flex-wrap items-center gap-2 pt-1">
                    <Show when={writable()}>
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
                    </Show>
                  </div>
                  <Show when={writable()}>
                    <div class="mt-3 border-t border-white/[0.06] pt-3">
                      <Button
                        variant="destructive"
                        disabled={remove.isPending}
                        onClick={() => setConfirmDelete(true)}
                      >
                        Delete application
                      </Button>
                    </div>
                  </Show>
                  <ErrorText error={save.error ?? upload.error ?? remove.error ?? install.error} />
                  <Show when={message()}>
                    {(text) => (
                      <p
                        role="status"
                        class="rounded-lg border border-success/25 bg-success/[0.07] px-3 py-2 text-[12.5px] text-success-foreground"
                      >
                        {text()}
                      </p>
                    )}
                  </Show>
                  <Show when={installNotice()}>
                    {(notice) => (
                      <p
                        role="status"
                        class={
                          notice().tone === "success"
                            ? "rounded-lg border border-success/25 bg-success/[0.07] px-3 py-2 text-[12.5px] text-success-foreground"
                            : "rounded-lg border border-warning/25 bg-warning/[0.07] px-3 py-2 text-[12.5px] text-warning-foreground"
                        }
                      >
                        {notice().text}
                      </p>
                    )}
                  </Show>
                  <Show when={application().source === "upload"}>
                    <p class="rounded-lg border border-border bg-muted/20 px-3 py-2 text-[11.5px] leading-relaxed text-muted-foreground">
                      Uploaded files are stored and downloadable from the API, but Apple installs
                      still need a manifest URL or store ID.
                    </p>
                  </Show>
                </div>
              </Panel>
            </div>

            <div class="space-y-5">
              <Panel
                title="Assignments"
                description="Saved with the form above."
                actions={
                  <Badge variant="secondary" class="tabular-nums">
                    {assignedCount()}
                  </Badge>
                }
              >
                <div class="space-y-4">
                  <div>
                    <p class="mb-1.5 flex items-center justify-between gap-2 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                      <span>Groups</span>
                      <span class="tabular-nums">{groupIds().size}</span>
                    </p>
                    <Show
                      when={(groups.data?.rows.length ?? 0) > 0}
                      fallback={<p class="text-[12px] text-muted-foreground">No groups yet.</p>}
                    >
                      <div class="max-h-48 divide-y divide-border/60 overflow-auto rounded-lg border border-border">
                        <For each={groups.data?.rows ?? []}>
                          {(group: GroupRow) => (
                            <label class="flex items-center gap-2 px-2.5 py-1.5 text-[12.5px] transition-colors hover:bg-muted/30">
                              <input
                                type="checkbox"
                                class="size-3.5 shrink-0 accent-[var(--brand)]"
                                checked={groupIds().has(group.id)}
                                disabled={!writable()}
                                onChange={() => toggle(groupIds, setGroupIds, group.id)}
                              />
                              <span class="min-w-0 truncate">{group.name}</span>
                            </label>
                          )}
                        </For>
                      </div>
                    </Show>
                  </div>
                  <div>
                    <p class="mb-1.5 flex items-center justify-between gap-2 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                      <span>Devices</span>
                      <span class="tabular-nums">{deviceIds().size}</span>
                    </p>
                    <Show
                      when={(devices.data?.rows.length ?? 0) > 0}
                      fallback={
                        <p class="text-[12px] text-muted-foreground">No devices enrolled yet.</p>
                      }
                    >
                      <div class="max-h-48 divide-y divide-border/60 overflow-auto rounded-lg border border-border">
                        <For each={devices.data?.rows ?? []}>
                          {(device: DeviceRow) => (
                            <label class="flex items-center gap-2 px-2.5 py-1.5 text-[12.5px] transition-colors hover:bg-muted/30">
                              <input
                                type="checkbox"
                                class="size-3.5 shrink-0 accent-[var(--brand)]"
                                checked={deviceIds().has(device.id)}
                                disabled={!writable()}
                                onChange={() => toggle(deviceIds, setDeviceIds, device.id)}
                              />
                              <span class="min-w-0 flex-1 truncate">{device.name}</span>
                              <span class="shrink-0 text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground">
                                {device.proto}
                              </span>
                            </label>
                          )}
                        </For>
                      </div>
                    </Show>
                  </div>
                  <p class="text-[11px] leading-relaxed text-muted-foreground">
                    Assignments are saved with the form. Apple installs are queued on the next
                    check-in; Windows and Android delivery is not implemented yet.
                  </p>
                </div>
              </Panel>

              <Panel title="Delivery" description="Where this installer resolves from.">
                <dl class="space-y-2 text-[12px]">
                  <div class="flex items-center justify-between gap-3">
                    <dt class="text-muted-foreground">Platform</dt>
                    <dd>
                      <PlatformBadge proto={application().platform} />
                    </dd>
                  </div>
                  <div class="flex items-center justify-between gap-3">
                    <dt class="text-muted-foreground">Source</dt>
                    <dd class="text-foreground">{sourceLabel(application().source)}</dd>
                  </div>
                  <Show when={application().manifestUrl}>
                    <div class="min-w-0">
                      <dt class="text-muted-foreground">Manifest</dt>
                      <dd class="truncate font-mono text-[11px] text-foreground">
                        {application().manifestUrl}
                      </dd>
                    </div>
                  </Show>
                  <Show when={application().storeId}>
                    <div class="flex items-center justify-between gap-3">
                      <dt class="text-muted-foreground">Store ID</dt>
                      <dd class="font-mono text-[11px] text-foreground">{application().storeId}</dd>
                    </div>
                  </Show>
                  <div class="flex items-center justify-between gap-3">
                    <dt class="text-muted-foreground">Install</dt>
                    <dd class="text-[11.5px] text-foreground">
                      {canInstall() ? "Supported (Apple)" : "Not implemented"}
                    </dd>
                  </div>
                </dl>
              </Panel>
            </div>
          </div>
        )}
      </Show>

      <ConfirmDialog
        open={confirmDelete()}
        onOpenChange={setConfirmDelete}
        title={`Delete ${row()?.name ?? "this application"}?`}
        description="This removes the application and its assignments. This cannot be undone."
        confirmLabel="Delete application"
        destructive
        pending={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </Page>
  );
}
