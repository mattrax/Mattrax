import { useParams } from "@solidjs/router";
import { useNavigate } from "~/lib/navigation";
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

const selectClass =
  "h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-[13px] text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30";

type InstallerDraft = {
  id?: string;
  platform: "apple" | "win" | "android";
  source: "manifest" | "store" | "upload";
  bundleId: string;
  version: string;
  manifestUrl: string;
  storeId: string;
  minOsVersion: string;
  requiredCapability: string;
  priority: string;
};

const installerDraft = (value: ApplicationNode["installers"][number]): InstallerDraft => ({
  id: value.id,
  platform: value.platform,
  source: value.source,
  bundleId: value.bundleId ?? "",
  version: value.version ?? "",
  manifestUrl: value.manifestUrl ?? "",
  storeId: value.storeId ?? "",
  minOsVersion: value.minOsVersion ?? "",
  requiredCapability: value.requiredCapability ?? "",
  priority: String(value.priority),
});

const sourceLabel = (source: ApplicationNode["source"]) =>
  Match.value(source).pipe(
    Match.when("manifest", () => "Manifest URL"),
    Match.when("store", () => "App Store"),
    Match.orElse(() => "Uploaded file"),
  );

const installButtonLabel = (input: {
  readonly pending: boolean;
  readonly viaVpp: boolean;
  readonly platform: "apple" | "win" | "android" | undefined;
}): string => {
  if (input.pending) return "Queueing…";

  if (input.viaVpp && input.platform === "apple") return "Install via VPP on assigned devices";

  switch (input.platform) {
    case "android":
      return "Push Android policy to assigned devices";
    default:
      return "Install on assigned devices";
  }
};

const identityFieldLabel = (platform: "apple" | "win" | "android" | undefined): string => {
  switch (platform) {
    case "android":
      return "Managed Google Play package";
    case "win":
      return "MSI ProductCode";
    default:
      return "Bundle / package ID";
  }
};

const installMechanismLabel = (platform: "apple" | "win" | "android" | undefined): string => {
  switch (platform) {
    case "win":
      return "EnterpriseDesktopAppManagement (MSI)";
    case "android":
      return "Managed Google Play policy";
    default:
      return "InstallApplication / InstallEnterpriseApplication";
  }
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
  const [installers, setInstallers] = createSignal<InstallerDraft[]>([]);
  const [notes, setNotes] = createSignal("");
  const [groupIds, setGroupIds] = createSignal<Set<string>>(new Set());
  const [deviceIds, setDeviceIds] = createSignal<Set<string>>(new Set());
  const [message, setMessage] = createSignal<string | null>(null);

  createEffect(
    // Re-sync after a save assigns ids to newly created installers, not only
    // when a different application is opened.
    () => `${row()?.id ?? ""}:${row()?.updatedAt ?? ""}`,
    () => {
      const value = row();

      if (!value) return;
      setName(value.name);
      setBundleId(value.bundleId ?? "");
      setVersion(value.version ?? "");
      setInstallers(value.installers.map(installerDraft));
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
        notes: notes() || null,
        installers: installers().map((installer) => ({
          id: installer.id,
          platform: installer.platform,
          source: installer.source,
          bundleId: installer.bundleId || null,
          version: installer.version || null,
          manifestUrl: installer.manifestUrl || null,
          storeId: installer.storeId || null,
          minOsVersion: installer.minOsVersion || null,
          requiredCapability: installer.requiredCapability || null,
          priority: Number(installer.priority) || 0,
        })),
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

  const uploadInstaller = useMutation(() => ({
    mutationFn: async (installerId: string) => {
      const file = await selectFile("*/*");

      return enterprise.uploadApplicationInstaller(
        params.tenantId,
        params.applicationId,
        installerId,
        {
          fileName: file.name,
          contentType: file.type || undefined,
          content: arrayBufferToBase64(await file.arrayBuffer()),
        },
      );
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
  const canInstall = createMemo(() => installers().length > 0);
  const assignedCount = () => groupIds().size + deviceIds().size;

  /** Why the install button is disabled, or undefined when it can be pressed. */
  const installDisabledReason = () => {
    if (!canInstall()) return "Add at least one installer before installing.";

    if (assignedCount() === 0) return "Assign this application to a device or group first.";

    return undefined;
  };

  const storeId = () =>
    installers().find((installer) => installer.platform === "apple" && installer.storeId)
      ?.storeId ?? "";

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
                disabled={
                  !canInstall() || install.isPending || installDisabledReason() !== undefined
                }
                title={installDisabledReason()}
                onClick={() => install.mutate()}
              >
                {installButtonLabel({
                  pending: install.isPending,
                  viaVpp: Boolean(vppAsset()),
                  platform: platform(),
                })}
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
                      <div class="rounded-lg border border-border bg-surface p-3">
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

                  <Show
                    when={
                      platform() === "apple" &&
                      vpp.data?.configured &&
                      vppAssets.data &&
                      !vppAsset()
                    }
                  >
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
                  <div class="space-y-3">
                    <div class="flex items-center justify-between gap-2">
                      <p class="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                        Installers
                      </p>
                      <Show when={writable()}>
                        <Button
                          variant="outline"
                          onClick={() =>
                            setInstallers((current) => [
                              ...current,
                              {
                                platform: "apple",
                                source: "manifest",
                                bundleId: bundleId(),
                                version: version(),
                                manifestUrl: "",
                                storeId: "",
                                minOsVersion: "",
                                requiredCapability: "",
                                priority: "0",
                              },
                            ])
                          }
                        >
                          Add installer
                        </Button>
                      </Show>
                    </div>
                    <Show
                      when={installers().length > 0}
                      fallback={
                        <p class="text-[12px] text-muted-foreground">
                          This application has no installers.
                        </p>
                      }
                    >
                      <For each={installers()}>
                        {(installer, index) => (
                          <div class="space-y-3 rounded-lg border border-border bg-surface p-3">
                            <div class="flex items-center justify-between gap-2">
                              <span class="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                                Installer {index() + 1}
                              </span>
                              <Show when={writable()}>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() =>
                                    setInstallers((current) =>
                                      current.filter((_, item) => item !== index()),
                                    )
                                  }
                                >
                                  Remove
                                </Button>
                              </Show>
                            </div>
                            <div class="grid gap-3 sm:grid-cols-2">
                              <Field label="Platform">
                                <select
                                  class={selectClass}
                                  disabled={!writable()}
                                  value={installer.platform}
                                  onChange={(event) =>
                                    setInstallers((current) =>
                                      current.map((item, itemIndex) =>
                                        itemIndex === index()
                                          ? {
                                              ...item,
                                              // SAFETY: the <select> only offers the three
                                              // InstallerDraft platform values.
                                              platform: event.currentTarget
                                                .value as InstallerDraft["platform"],
                                            }
                                          : item,
                                      ),
                                    )
                                  }
                                >
                                  <option value="apple">Apple</option>
                                  <option value="win">Windows</option>
                                  <option value="android">Android</option>
                                </select>
                              </Field>
                              <Field label="Source">
                                <select
                                  class={selectClass}
                                  disabled={!writable()}
                                  value={installer.source}
                                  onChange={(event) =>
                                    setInstallers((current) =>
                                      current.map((item, itemIndex) =>
                                        itemIndex === index()
                                          ? {
                                              ...item,
                                              // SAFETY: the <select> only offers the three
                                              // InstallerDraft source values.
                                              source: event.currentTarget
                                                .value as InstallerDraft["source"],
                                            }
                                          : item,
                                      ),
                                    )
                                  }
                                >
                                  <option value="manifest">Manifest / native</option>
                                  <option value="store">Store</option>
                                  <option value="upload">Uploaded file</option>
                                </select>
                              </Field>
                              <Field label={identityFieldLabel(installer.platform)}>
                                <Input
                                  disabled={!writable()}
                                  value={installer.bundleId}
                                  onInput={(event) =>
                                    setInstallers((current) =>
                                      current.map((item, itemIndex) =>
                                        itemIndex === index()
                                          ? { ...item, bundleId: event.currentTarget.value }
                                          : item,
                                      ),
                                    )
                                  }
                                />
                              </Field>
                              <Field label="Version">
                                <Input
                                  disabled={!writable()}
                                  value={installer.version}
                                  onInput={(event) =>
                                    setInstallers((current) =>
                                      current.map((item, itemIndex) =>
                                        itemIndex === index()
                                          ? { ...item, version: event.currentTarget.value }
                                          : item,
                                      ),
                                    )
                                  }
                                />
                              </Field>
                              <Field label="Manifest / installer URL">
                                <Input
                                  disabled={!writable()}
                                  value={installer.manifestUrl}
                                  onInput={(event) =>
                                    setInstallers((current) =>
                                      current.map((item, itemIndex) =>
                                        itemIndex === index()
                                          ? { ...item, manifestUrl: event.currentTarget.value }
                                          : item,
                                      ),
                                    )
                                  }
                                />
                              </Field>
                              <Field label="Store ID">
                                <Input
                                  disabled={!writable()}
                                  value={installer.storeId}
                                  onInput={(event) =>
                                    setInstallers((current) =>
                                      current.map((item, itemIndex) =>
                                        itemIndex === index()
                                          ? { ...item, storeId: event.currentTarget.value }
                                          : item,
                                      ),
                                    )
                                  }
                                />
                              </Field>
                              <Field label="Minimum OS" hint="Optional, e.g. 14.2">
                                <Input
                                  disabled={!writable()}
                                  value={installer.minOsVersion}
                                  onInput={(event) =>
                                    setInstallers((current) =>
                                      current.map((item, itemIndex) =>
                                        itemIndex === index()
                                          ? { ...item, minOsVersion: event.currentTarget.value }
                                          : item,
                                      ),
                                    )
                                  }
                                />
                              </Field>
                              <Field label="Required capability" hint="Optional, e.g. vpp">
                                <Input
                                  disabled={!writable()}
                                  value={installer.requiredCapability}
                                  onInput={(event) =>
                                    setInstallers((current) =>
                                      current.map((item, itemIndex) =>
                                        itemIndex === index()
                                          ? {
                                              ...item,
                                              requiredCapability: event.currentTarget.value,
                                            }
                                          : item,
                                      ),
                                    )
                                  }
                                />
                              </Field>
                              <Field label="Priority">
                                <Input
                                  type="number"
                                  disabled={!writable()}
                                  value={installer.priority}
                                  onInput={(event) =>
                                    setInstallers((current) =>
                                      current.map((item, itemIndex) =>
                                        itemIndex === index()
                                          ? { ...item, priority: event.currentTarget.value }
                                          : item,
                                      ),
                                    )
                                  }
                                />
                              </Field>
                            </div>
                            <Show when={installer.source === "upload"}>
                              <div class="flex flex-wrap items-center gap-2">
                                <Show when={writable()}>
                                  <Button
                                    variant="outline"
                                    disabled={!installer.id || uploadInstaller.isPending}
                                    onClick={() =>
                                      installer.id && uploadInstaller.mutate(installer.id)
                                    }
                                  >
                                    {uploadInstaller.isPending
                                      ? "Uploading…"
                                      : installer.id
                                        ? "Upload installer file"
                                        : "Save before uploading"}
                                  </Button>
                                </Show>
                                <span class="text-[11px] text-muted-foreground">
                                  {application().installers.find((item) => item.id === installer.id)
                                    ?.sha256
                                    ? `sha256 ${application()
                                        .installers.find((item) => item.id === installer.id)!
                                        .sha256!.slice(0, 16)}…`
                                    : "No file uploaded"}
                                </span>
                              </div>
                            </Show>
                          </div>
                        )}
                      </For>
                    </Show>
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
                    <div class="mt-3 border-t border-border pt-3">
                      <Button
                        variant="destructive"
                        disabled={remove.isPending}
                        onClick={() => setConfirmDelete(true)}
                      >
                        Delete application
                      </Button>
                    </div>
                  </Show>
                  <ErrorText
                    error={
                      save.error ??
                      upload.error ??
                      uploadInstaller.error ??
                      remove.error ??
                      install.error
                    }
                  />
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
                      {application().platform === "apple"
                        ? "Upload a signed .pkg. Mattrax serves it to each assigned Mac through a signed, expiring URL and installs it with InstallEnterpriseApplication. An .ipa needs an OTA manifest URL."
                        : "Uploaded files are kept for download; Windows installs from the MSI URL and Android installs from Managed Google Play."}
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
                                class="size-3.5 shrink-0 accent-[var(--brand-solid)]"
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
                                class="size-3.5 shrink-0 accent-[var(--brand-solid)]"
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
                    check-in; Windows runs the MSI on its next SyncML check-in; Android repushes the
                    Managed Google Play policy.
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
                      {installMechanismLabel(application().platform)}
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
