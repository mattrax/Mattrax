import { useNavigate, useParams } from "@solidjs/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { Match, Option, Schema } from "effect";
import { createEffect, createMemo, createSignal, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import {
  DEFAULT_BRAND_COLOR,
  isLogoUrl,
  normalizeBrandColor,
  resolveTenantBranding,
  TENANT_IMPORT_MAX_BYTES,
  validateTenantBranding,
  TenantImportRequest as TenantImportRequestSchema,
  type TenantImportRequest,
  type TenantImportResponse,
} from "@mattrax/enterprise-domain/client";
import { ErrorText, Panel, QueryError } from "~/components/mdm/common";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { TriangleAlert } from "~/components/ui/icons";
import { Input } from "~/components/ui/input";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import { enterprise, enterpriseKeys } from "~/lib/enterprise";
import { tenantRoleName, ReadOnlyNotice, useCan } from "~/lib/permissions";
import { cn } from "~/lib/utils";
import { withStepUp } from "~/lib/step-up";
import { errorPresentation, raisedFailure } from "~/lib/errors";

/**
 * Turn an HTTP failure into a friendly message. Tagged API failures are
 * normalised by `errorPresentation`; anything else keeps the status fallback
 * instead of surfacing a raw response body.
 */
const StepUpFailure = Schema.Struct({
  _tag: Schema.Literal("StepUpRequired"),
  action: Schema.optional(Schema.String),
  methods: Schema.optional(Schema.Array(Schema.String)),
});

const isStepUpFailure = Schema.is(StepUpFailure);

const decodeTenantImport = Schema.decodeUnknownOption(TenantImportRequestSchema);

const responseFailure = async (response: Response, fallback: string) => {
  const text = await response.text().catch(() => "");
  let body: Schema.Json | undefined = text;

  try {
    body = text
      ? Option.getOrUndefined(Schema.decodeUnknownOption(Schema.Json)(JSON.parse(text)))
      : undefined;
  } catch {
    // Plain-text error bodies are replaced by the status fallback below.
  }

  const presentation = errorPresentation(raisedFailure(body), fallback);

  return new Error(presentation.tag ? presentation.message : fallback);
};

export default function GeneralSettingsPage() {
  const params = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { can } = useCan();
  const canWrite = () => can("tenant.write");
  const canExport = () => can("tenant.export");
  const canImport = () => can("tenant.import");
  const canBackups = () => can("backups.read");
  const canRunBackup = () => can("backups.write");
  const canDelete = () => can("tenant.delete");

  const tenant = useQuery(() => ({
    queryKey: enterpriseKeys.tenant(params.tenantId),
    queryFn: () => enterprise.getTenant(params.tenantId),
  }));

  const [name, setName] = createSignal("");
  const [slug, setSlug] = createSignal("");
  const [displayName, setDisplayName] = createSignal("");
  const [logo, setLogo] = createSignal("");
  const [supportEmail, setSupportEmail] = createSignal("");
  const [brandColor, setBrandColor] = createSignal("");
  const [confirm, setConfirm] = createSignal("");
  const [deleteOpen, setDeleteOpen] = createSignal(false);
  const [includeAudit, setIncludeAudit] = createSignal(false);
  const [exporting, setExporting] = createSignal(false);
  const [exportError, setExportError] = createSignal<unknown>();
  const [importOpen, setImportOpen] = createSignal(false);
  const [importFileName, setImportFileName] = createSignal("");
  const [importBundle, setImportBundle] = createSignal<TenantImportRequest | null>(null);
  const [importError, setImportError] = createSignal<unknown>();
  const [importing, setImporting] = createSignal(false);
  const [importResult, setImportResult] = createSignal<TenantImportResponse | null>(null);
  const [saved, setSaved] = createSignal(false);
  let importFileInput: HTMLInputElement | undefined;

  createEffect(
    () => tenant.data?.id,
    () => {
      const data = tenant.data;

      if (data) {
        setName(data.name);
        setSlug(data.slug);
        setDisplayName(data.displayName ?? "");
        setLogo(data.logo ?? "");
        setSupportEmail(data.supportEmail ?? "");
        setBrandColor(data.brandColor ?? "");
      }
    },
  );

  const brandingErrors = createMemo(() =>
    validateTenantBranding({
      displayName: displayName() || null,
      logo: logo() || null,
      supportEmail: supportEmail() || null,
      brandColor: brandColor() || null,
    }),
  );

  const hasBrandingErrors = () => Object.keys(brandingErrors()).length > 0;
  const colorValue = () => normalizeBrandColor(brandColor() || "") ?? DEFAULT_BRAND_COLOR;

  const preview = createMemo(() =>
    resolveTenantBranding({
      name: name() || "Tenant",
      displayName: displayName() || null,
      logo: logo() || null,
      supportEmail: supportEmail() || null,
      brandColor: brandColor() || null,
    }),
  );

  const dirty = () => {
    const current = tenant.data;

    if (!current) return false;

    return (
      name() !== current.name ||
      slug() !== current.slug ||
      displayName() !== (current.displayName ?? "") ||
      logo() !== (current.logo ?? "") ||
      supportEmail() !== (current.supportEmail ?? "") ||
      brandColor() !== (current.brandColor ?? "")
    );
  };

  const save = useMutation(() => ({
    mutationFn: () =>
      enterprise.patchTenant(params.tenantId, {
        name: name(),
        slug: slug(),
        displayName: displayName() || null,
        logo: logo() || null,
        supportEmail: supportEmail() || null,
        brandColor: brandColor() || null,
      }),
    onSuccess: async () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      await qc.invalidateQueries({ queryKey: enterpriseKeys.tenant(params.tenantId) });
      await qc.invalidateQueries({ queryKey: enterpriseKeys.me() });
    },
  }));

  const del = useMutation(() => ({
    mutationFn: () => enterprise.deleteTenant(params.tenantId),
    onSuccess: async (result) => {
      setDeleteResult(result);
      await qc.invalidateQueries({ queryKey: enterpriseKeys.me() });
    },
  }));

  const [deleteResult, setDeleteResult] = createSignal<{
    reclaimed: {
      devices: number;
      contacted: number;
      unreachableDevices: ReadonlyArray<{
        id: string;
        name: string;
        platform: string;
        reason: string;
      }>;
      objects: number;
      subscription: string;
    };
  } | null>(null);

  // Backups are an operational admin surface. Skip the request entirely for
  // roles that cannot read it instead of retrying a 403 on every visit.
  const backups = useQuery(() => ({
    queryKey: enterpriseKeys.backups(params.tenantId),
    queryFn: () => enterprise.listTenantBackups(params.tenantId),
    enabled: canBackups(),
    retry: false,
  }));

  const [backupDownloadError, setBackupDownloadError] = createSignal<unknown>(null);

  const backupNow = useMutation(() => ({
    mutationFn: () => enterprise.runTenantBackup(params.tenantId),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: enterpriseKeys.backups(params.tenantId) });
    },
  }));

  const refetchBackups = () =>
    qc.invalidateQueries({ queryKey: enterpriseKeys.backups(params.tenantId) });

  const [backupActionError, setBackupActionError] = createSignal<unknown>(null);

  const [restoreTarget, setRestoreTarget] = createSignal<{ id: string; startedAt: string } | null>(
    null,
  );

  const [restoreConfirm, setRestoreConfirm] = createSignal("");

  const [restoreResult, setRestoreResult] = createSignal<{
    preRestoreBackupId: string;
    counts: {
      groups: number;
      policies: number;
      applications: number;
      preRegistrations: number;
      devices: number;
    };
  } | null>(null);

  const [deleteBackupTarget, setDeleteBackupTarget] = createSignal<{
    id: string;
    startedAt: string;
  } | null>(null);

  const pinBackup = useMutation(() => ({
    mutationFn: (run: { id: string; retention: string }) =>
      run.retention === "pinned"
        ? enterprise.unpinTenantBackup(params.tenantId, run.id)
        : enterprise.pinTenantBackup(params.tenantId, run.id),
    onMutate: () => setBackupActionError(null),
    onSuccess: () => refetchBackups(),
    onError: setBackupActionError,
  }));

  const removeBackup = useMutation(() => ({
    mutationFn: (id: string) => enterprise.deleteTenantBackup(params.tenantId, id),
    onMutate: () => setBackupActionError(null),
    onSuccess: async () => {
      setDeleteBackupTarget(null);
      await refetchBackups();
    },
    onError: setBackupActionError,
  }));

  const restoreBackup = useMutation(() => ({
    mutationFn: (input: { id: string; confirm: string }) =>
      enterprise.restoreTenantBackup(params.tenantId, input.id, input.confirm),
    onMutate: () => setBackupActionError(null),
    onSuccess: async (result) => {
      setRestoreResult({
        preRestoreBackupId: result.preRestoreBackupId,
        counts: result.counts,
      });
      await Promise.all([
        refetchBackups(),
        qc.invalidateQueries({ queryKey: enterpriseKeys.tenant(params.tenantId) }),
      ]);
    },
    onError: setBackupActionError,
  }));

  // Plain functions, not memos: a memo created in the component body would
  // eagerly read the query's pending async value and suspend the whole page.
  const latestBackup = () => backups.data?.backups?.[0];

  const backupWarning = () => {
    const latest = latestBackup();

    if (!latest) return "No backup has run yet.";

    if (latest.status === "failed")
      return "The most recent backup failed. Retry it or check the error below.";

    if (latest.status === "running") return "A backup is currently running.";
    const age = Date.now() - new Date(latest.startedAt).getTime();

    if (Number.isFinite(age) && age > 48 * 60 * 60 * 1000)
      return "The most recent successful backup is more than two days old.";

    return null;
  };

  const formatBackupSize = (bytes: number | null | undefined) => {
    if (bytes == null) return "—";

    if (bytes < 1024) return `${bytes} B`;

    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;

    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const downloadBackup = async (id: string) => {
    setBackupDownloadError(null);

    try {
      const response = await withStepUp("backup-download", async (grant) => {
        const result = await fetch(
          `/api/v1/tenants/${encodeURIComponent(params.tenantId ?? "")}/backups/${encodeURIComponent(
            id,
          )}/download`,
          {
            credentials: "include",
            headers: grant ? { "x-mattrax-step-up": grant } : undefined,
          },
        );

        if (result.status === 403) {
          const body = await result.json().catch(() => null);

          if (isStepUpFailure(body)) throw body;
        }

        return result;
      });

      if (!response.ok)
        throw await responseFailure(response, `Download failed (${response.status})`);
      const disposition = response.headers.get("Content-Disposition") ?? "";

      const filename =
        /filename="([^"]+)"/.exec(disposition)?.[1] ??
        `tenant-${tenant.data?.slug ?? params.tenantId ?? "backup"}-backup.json`;

      download(await response.text(), filename);
    } catch (error) {
      setBackupDownloadError(error);
    }
  };

  const download = (body: string, filename: string) => {
    const url = URL.createObjectURL(new Blob([body], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const exportTenant = async () => {
    setExporting(true);
    setExportError(undefined);

    try {
      const suffix = includeAudit() ? "?includeAudit=true" : "";

      const response = await fetch(
        `/api/v1/tenants/${encodeURIComponent(params.tenantId ?? "")}/export${suffix}`,
        { credentials: "include" },
      );

      if (!response.ok) throw await responseFailure(response, `Export failed (${response.status})`);
      const disposition = response.headers.get("Content-Disposition") ?? "";

      const filename =
        /filename="([^"]+)"/.exec(disposition)?.[1] ??
        `tenant-${tenant.data?.slug ?? params.tenantId ?? "export"}.json`;

      download(await response.text(), filename);
    } catch (error) {
      setExportError(error);
    } finally {
      setExporting(false);
    }
  };

  const resetImport = () => {
    setImportFileName("");
    setImportBundle(null);
    setImportError(undefined);
    setImportResult(null);

    if (importFileInput) importFileInput.value = "";
  };

  const openImport = () => {
    resetImport();
    setImportOpen(true);
  };

  const chooseImportFile = () => importFileInput?.click();

  const readImportFile = async (file: File | undefined) => {
    setImportFileName(file?.name ?? "");
    setImportBundle(null);
    setImportResult(null);
    setImportError(undefined);

    if (!file) return;

    try {
      if (file.size > TENANT_IMPORT_MAX_BYTES)
        throw new Error(
          `The bundle is too large. The limit is ${TENANT_IMPORT_MAX_BYTES / 1024} KB.`,
        );
      const parsed = Option.getOrUndefined(decodeTenantImport(JSON.parse(await file.text())));

      if (parsed === undefined) throw new Error("This file is not a Mattrax tenant bundle.");

      setImportBundle(parsed);
    } catch (error) {
      setImportError(error);
    }
  };

  const runImport = async () => {
    const bundle = importBundle();

    if (!bundle) return;
    setImporting(true);
    setImportError(undefined);

    try {
      const result = await enterprise.importTenant(bundle);
      setImportResult(result);
      await qc.invalidateQueries({ queryKey: enterpriseKeys.me() });
      await qc.invalidateQueries({ queryKey: enterpriseKeys.tenants() });
    } catch (error) {
      setImportError(error);
    } finally {
      setImporting(false);
    }
  };

  const importSummary = createMemo(() => {
    const bundle = importBundle();

    if (!bundle) return null;

    return {
      name: bundle.tenant.name,
      slug: bundle.tenant.slug ?? "",
      groups: bundle.groups?.length ?? 0,
      policies: bundle.policies?.length ?? 0,
      applications: bundle.applications?.length ?? 0,
      preRegistrations: bundle.preRegistrations?.length ?? 0,
      members: bundle.members?.length ?? 0,
      devices: (bundle.groups ?? []).reduce(
        (total, group) => total + (group.devices?.length ?? 0),
        0,
      ),
      certificates: bundle.scepCertificates?.length ?? 0,
      auditLog: bundle.auditLog?.length ?? 0,
    };
  });

  return (
    <div class="grid gap-5 xl:grid-cols-2">
      <QueryError
        class="xl:col-span-2"
        error={tenant.error}
        onRetry={() => void tenant.refetch()}
      />

      <Panel
        title="Tenant profile"
        description="The name, identifiers and branding shown across the dashboard and enrollment pages."
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          <div class="divide-y divide-white/[0.05]">
            <FieldRow label="Name" hint="Internal tenant name used by the dashboard.">
              <Input
                disabled={!canWrite()}
                value={name()}
                onInput={(e) => setName(e.currentTarget.value)}
                required
              />
            </FieldRow>
            <FieldRow label="Slug" hint="Used in URLs and when generating identifiers.">
              <Input
                disabled={!canWrite()}
                value={slug()}
                pattern="[a-z0-9-]+"
                onInput={(e) => setSlug(e.currentTarget.value.toLowerCase())}
                required
              />
            </FieldRow>
            <FieldRow
              label="Display name"
              hint="Shown on the enrollment page, Apple profile and tenant emails. Falls back to the name above."
            >
              <Input
                disabled={!canWrite()}
                value={displayName()}
                placeholder={name() || "Mattrax"}
                onInput={(e) => setDisplayName(e.currentTarget.value)}
              />
              <Show when={brandingErrors().displayName}>
                <span class="mt-1.5 block text-xs text-destructive">
                  {brandingErrors().displayName}
                </span>
              </Show>
            </FieldRow>
            <FieldRow
              label="Logo"
              hint="An https URL, an inline data: image URL, or an absolute path."
            >
              <Input
                disabled={!canWrite()}
                value={logo()}
                placeholder="https://example.com/logo.png"
                onInput={(e) => setLogo(e.currentTarget.value)}
              />
              <Show when={brandingErrors().logo}>
                <span class="mt-1.5 block text-xs text-destructive">{brandingErrors().logo}</span>
              </Show>
            </FieldRow>
            <FieldRow label="Support email" hint="Shown to people enrolling a device.">
              <Input
                type="email"
                disabled={!canWrite()}
                value={supportEmail()}
                placeholder="hello@mattrax.app"
                onInput={(e) => setSupportEmail(e.currentTarget.value)}
              />
              <Show when={brandingErrors().supportEmail}>
                <span class="mt-1.5 block text-xs text-destructive">
                  {brandingErrors().supportEmail}
                </span>
              </Show>
            </FieldRow>
            <FieldRow label="Brand colour" hint="Used for accents on the public enrollment page.">
              <div class="flex items-center gap-2">
                <input
                  type="color"
                  aria-label="Brand colour picker"
                  disabled={!canWrite()}
                  class="h-8 w-11 shrink-0 cursor-pointer rounded-md border border-input bg-white/[0.03] p-1"
                  value={colorValue()}
                  onInput={(e) => setBrandColor(e.currentTarget.value)}
                />
                <Input
                  aria-label="Brand colour hex value"
                  disabled={!canWrite()}
                  value={brandColor()}
                  placeholder={DEFAULT_BRAND_COLOR}
                  onInput={(e) => setBrandColor(e.currentTarget.value)}
                />
              </div>
              <Show when={brandingErrors().brandColor}>
                <span class="mt-1.5 block text-xs text-destructive">
                  {brandingErrors().brandColor}
                </span>
              </Show>
            </FieldRow>
          </div>
          <div class="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.06] pt-4">
            <Show when={tenant.data}>
              <span class="text-xs text-muted-foreground">
                Created {new Date(tenant.data!.createdAt).toLocaleDateString()}
              </span>
            </Show>
            <Show when={canWrite()}>
              <Button
                type="submit"
                class="ml-auto"
                disabled={save.isPending || hasBrandingErrors() || !dirty()}
              >
                {save.isPending ? "Saving…" : "Save changes"}
              </Button>
              <Show when={saved()}>
                <span role="status" class="text-xs text-success-foreground">
                  Saved.
                </span>
              </Show>
            </Show>
          </div>
          <Show when={!canWrite()}>
            <ReadOnlyNotice class="mt-3">
              Your role can view these settings but not change them.
            </ReadOnlyNotice>
          </Show>
          <ErrorText error={save.error} />
        </form>
      </Panel>

      <div class="flex min-w-0 flex-col gap-5">
        <Panel
          title="Branding preview"
          description="How the public enrollment page looks with the values above."
        >
          <div class="overflow-hidden rounded-lg border border-white/[0.08] bg-white/[0.015]">
            <div class="h-1.5" style={{ "background-color": preview().brandColor }} />
            <div class="space-y-4 p-4">
              <div class="flex items-center gap-3">
                <Show when={preview().logo && isLogoUrl(preview().logo!)}>
                  <img
                    src={preview().logo!}
                    alt=""
                    class="size-10 shrink-0 rounded-md bg-white/[0.04] object-contain p-1"
                  />
                </Show>
                <div class="min-w-0">
                  <p class="truncate text-[13.5px] font-semibold text-foreground">
                    Enroll in {preview().displayName}
                  </p>
                  <p class="text-xs text-muted-foreground">Device enrollment</p>
                </div>
              </div>
              <div
                class="rounded-lg px-3 py-2 text-center text-[13px] font-medium"
                style={{ "background-color": preview().brandColor, color: "#fff" }}
              >
                Continue
              </div>
              <p class="text-xs text-muted-foreground">
                Need help? Contact{" "}
                <a
                  class="break-all font-medium text-foreground underline underline-offset-2"
                  href={`mailto:${preview().supportEmail}`}
                >
                  {preview().supportEmail}
                </a>
              </p>
            </div>
          </div>
          <p class="mt-3 text-xs leading-relaxed text-muted-foreground">
            This preview uses the values above before you save. Unset values fall back to the
            Mattrax defaults.
          </p>
        </Panel>

        <Panel title="Tenant details">
          <div class="divide-y divide-white/[0.05] text-[13px]">
            <DetailRow label="Tenant ID">
              <span class="break-all font-mono text-xs text-muted-foreground">
                {params.tenantId ?? ""}
              </span>
            </DetailRow>
            <DetailRow label="Your role">
              <span class="font-medium capitalize text-foreground">
                {tenantRoleName(tenant.data) ?? "…"}
              </span>
            </DetailRow>
            <DetailRow label="Devices">
              <span class="text-right text-foreground">Managed from the Devices page</span>
            </DetailRow>
          </div>
          <p class="mt-3 text-xs leading-relaxed text-muted-foreground">
            Tenant resources (devices, groups, policies, members) are isolated from every other
            tenant.
          </p>
        </Panel>
      </div>

      <Panel
        class="xl:col-span-2"
        title="Data and backups"
        description="Versioned JSON bundles for moving a tenant between deployments."
      >
        <div class="divide-y divide-white/[0.05]">
          <section class="flex flex-col gap-4 pb-5 sm:flex-row sm:items-start sm:justify-between sm:gap-8">
            <div class="min-w-0 max-w-2xl">
              <h3 class="text-[13px] font-semibold text-foreground">Export tenant</h3>
              <p class="mt-1 text-xs leading-relaxed text-muted-foreground">
                Download a versioned JSON bundle containing this tenant's profile and branding,
                groups, policies and configurations, application metadata, enrollment settings and
                pre-registrations. APNs/SCEP private keys, token hashes, passwords, sessions and
                stored object bytes are never included.
              </p>
              <label class="mt-3 flex items-start gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  class="mt-0.5 size-3.5 shrink-0 accent-brand"
                  checked={includeAudit()}
                  onChange={(event) => setIncludeAudit(event.currentTarget.checked)}
                />
                Include the audit log (up to 10,000 recent entries)
              </label>
              <Show when={tenant.data && !canExport()}>
                <p class="mt-2 text-xs text-muted-foreground">
                  Your role cannot export or import tenant data.
                </p>
              </Show>
              <ErrorText error={exportError()} />
            </div>
            <div class="shrink-0">
              <Button
                variant="outline"
                onClick={exportTenant}
                disabled={!canExport() || exporting()}
              >
                {exporting() ? "Preparing…" : "Export tenant"}
              </Button>
            </div>
          </section>

          <section
            class="flex flex-col gap-4 py-5 sm:flex-row sm:items-start sm:justify-between sm:gap-8"
            id="restore"
          >
            <div class="min-w-0 max-w-2xl">
              <h3 class="text-[13px] font-semibold text-foreground">Import tenant</h3>
              <p class="mt-1 text-xs leading-relaxed text-muted-foreground">
                Create a new tenant owned by you from a previously exported bundle. Internal ids are
                re-mapped, a free slug is chosen automatically, and the import is applied as one
                transaction.
              </p>
              <p class="mt-2 text-xs leading-relaxed text-muted-foreground">
                Members, devices, audit history and SCEP certificates are not imported. Uploaded
                application files must be re-uploaded after import.
              </p>
            </div>
            <div class="shrink-0">
              <Show when={canImport()}>
                <Button variant="outline" onClick={openImport}>
                  Import tenant
                </Button>
              </Show>
            </div>
          </section>

          <Show when={canBackups()}>
            <section class="pt-5">
              <div class="flex flex-wrap items-start justify-between gap-3">
                <div class="min-w-0 max-w-2xl">
                  <h3 class="text-[13px] font-semibold text-foreground">
                    Automatic tenant backups
                  </h3>
                  <p class="mt-1 text-xs leading-relaxed text-muted-foreground">
                    A JSON bundle is written to private object storage every day and after manual
                    runs. Bundles use the same shape as the export above: credentials, private keys,
                    token hashes and object bytes are never included. Downloads are authenticated
                    and go through the API; the R2 object is never public. Restore by downloading a
                    backup and importing it as a new tenant below.
                  </p>
                </div>
                <Button
                  variant="outline"
                  onClick={() => backupNow.mutate()}
                  disabled={!canRunBackup() || backupNow.isPending}
                >
                  {backupNow.isPending ? "Backing up…" : "Back up now"}
                </Button>
              </div>

              <Show when={backups.isError || backupNow.isError}>
                <ErrorText error={backups.error ?? backupNow.error} />
              </Show>
              <Show when={backupDownloadError()}>{(error) => <ErrorText error={error()} />}</Show>

              <Show when={latestBackup()}>
                {(latest) => (
                  <div class="mt-4 rounded-lg border border-white/[0.07] bg-white/[0.02] p-3 text-[13px]">
                    <div class="flex flex-wrap items-center justify-between gap-2">
                      <span class="text-muted-foreground">
                        Last backup:{" "}
                        <span class="font-medium text-foreground">
                          {latest().status === "succeeded" ? "Succeeded" : latest().status}
                        </span>{" "}
                        <span>{new Date(latest().startedAt).toLocaleString()}</span>
                      </span>
                      <Show when={latest().status === "succeeded"}>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void downloadBackup(latest().id)}
                        >
                          Download
                        </Button>
                      </Show>
                    </div>
                    <Show when={latest().error}>
                      <p class="mt-1 text-xs text-destructive">{latest().error}</p>
                    </Show>
                  </div>
                )}
              </Show>

              <Show when={backupWarning()}>
                {(warning) => (
                  <p
                    role="status"
                    class={cn(
                      "mt-3 rounded-lg border px-3 py-2 text-xs",
                      latestBackup()?.status === "failed"
                        ? "border-destructive/25 bg-destructive/[0.07] text-destructive"
                        : "border-warning/25 bg-warning/[0.07] text-warning-foreground",
                    )}
                  >
                    {warning()}
                  </p>
                )}
              </Show>

              <Show when={(backups.data?.backups ?? []).length > 0}>
                <div class="mt-4 overflow-x-auto rounded-lg border border-white/[0.07]">
                  <table class="w-full min-w-[34rem] text-left text-xs">
                    <thead class="border-b border-white/[0.06] bg-white/[0.02] text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                      <tr>
                        <th class="px-3 py-2 font-medium">Started</th>
                        <th class="px-3 py-2 font-medium">Trigger</th>
                        <th class="px-3 py-2 font-medium">Status</th>
                        <th class="px-3 py-2 font-medium">Size</th>
                        <th class="px-3 py-2 font-medium" />
                      </tr>
                    </thead>
                    <tbody class="divide-y divide-white/[0.05]">
                      {(backups.data?.backups ?? []).slice(0, 8).map((run) => (
                        <tr>
                          <td class="whitespace-nowrap px-3 py-2 text-muted-foreground">
                            {new Date(run.startedAt).toLocaleString()}
                          </td>
                          <td class="px-3 py-2 capitalize text-muted-foreground">{run.trigger}</td>
                          <td class="px-3 py-2">
                            <StatusChip
                              tone={Match.value(run.status).pipe(
                                Match.when("succeeded", () => "success" as const),
                                Match.when("failed", () => "danger" as const),
                                Match.orElse(() => "warning" as const),
                              )}
                            >
                              {run.status}
                            </StatusChip>
                            <Show when={run.retention === "pinned"}>
                              <span class="ml-1 text-[11px] font-medium text-warning-foreground">
                                pinned
                              </span>
                            </Show>
                            <Show when={run.error}>
                              <span class="ml-1 text-xs text-destructive" title={run.error ?? ""}>
                                ({run.error?.slice(0, 60)})
                              </span>
                            </Show>
                          </td>
                          <td class="px-3 py-2 text-muted-foreground">
                            {formatBackupSize(run.sizeBytes)}
                          </td>
                          <td class="px-3 py-2 text-right">
                            <div class="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
                              <Show when={run.status === "succeeded"}>
                                <button
                                  type="button"
                                  class="text-xs font-medium text-foreground underline decoration-white/25 underline-offset-2 transition-colors hover:decoration-white/60"
                                  onClick={() => void downloadBackup(run.id)}
                                >
                                  Download
                                </button>
                                <button
                                  type="button"
                                  class="text-xs font-medium text-foreground underline decoration-white/25 underline-offset-2 transition-colors hover:decoration-white/60"
                                  onClick={() => {
                                    setBackupActionError(null);
                                    setRestoreResult(null);
                                    setRestoreConfirm("");
                                    setRestoreTarget({ id: run.id, startedAt: run.startedAt });
                                  }}
                                >
                                  Restore
                                </button>
                              </Show>
                              <Show when={run.status !== "running"}>
                                <button
                                  type="button"
                                  class="text-xs font-medium text-foreground underline decoration-white/25 underline-offset-2 transition-colors hover:decoration-white/60"
                                  disabled={!canRunBackup()}
                                  onClick={() => pinBackup.mutate(run)}
                                >
                                  {run.retention === "pinned" ? "Unpin" : "Pin"}
                                </button>
                                <button
                                  type="button"
                                  class="text-xs font-medium text-destructive underline decoration-destructive/30 underline-offset-2 transition-colors hover:decoration-destructive/60"
                                  disabled={!canRunBackup()}
                                  onClick={() =>
                                    setDeleteBackupTarget({ id: run.id, startedAt: run.startedAt })
                                  }
                                >
                                  Delete
                                </button>
                              </Show>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Show>

              <ErrorText error={backupActionError()} />

              <p class="mt-3 text-xs leading-relaxed text-muted-foreground">
                Runs older than the configured retention window are deleted automatically. Pin a run
                to keep it until you unpin it. Restore replaces this tenant's groups, policies,
                applications and pre-registrations in place, keeps its members, devices and
                certificates, and takes a pinned snapshot first.{" "}
                <a
                  class="text-foreground underline decoration-white/25 underline-offset-2 transition-colors hover:decoration-white/60"
                  href="#restore"
                >
                  Import a bundle
                </a>{" "}
                instead to create a separate tenant.
              </p>
            </section>
          </Show>
        </div>
      </Panel>

      <input
        ref={(element) => {
          importFileInput = element;
        }}
        type="file"
        accept="application/json,.json"
        class="hidden"
        aria-label="Tenant bundle file"
        onChange={(event) => void readImportFile(event.currentTarget.files?.[0])}
      />

      <Dialog open={importOpen()} onOpenChange={setImportOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import a tenant bundle</DialogTitle>
            <DialogDescription>
              This creates a new tenant and makes you its owner. Nothing in the current tenant is
              changed.
            </DialogDescription>
          </DialogHeader>
          <Show when={!importResult()}>
            <div class="flex flex-wrap items-center gap-2">
              <Button variant="outline" onClick={chooseImportFile}>
                {importFileName() ? "Choose another bundle" : "Choose bundle"}
              </Button>
              <Show when={importFileName()}>
                <span class="min-w-0 break-all text-xs text-muted-foreground">
                  {importFileName()}
                </span>
              </Show>
            </div>
            <Show when={importSummary()}>
              {(summary) => (
                <div class="space-y-2 rounded-lg border border-white/[0.07] bg-white/[0.02] p-3 text-sm">
                  <p class="font-medium">
                    {summary().name}
                    <Show when={summary().slug}>
                      <span class="font-normal text-muted-foreground"> ({summary().slug})</span>
                    </Show>
                  </p>
                  <ul class="grid grid-cols-2 gap-1 text-xs text-muted-foreground">
                    <li>{summary().groups} groups</li>
                    <li>{summary().policies} policies</li>
                    <li>{summary().applications} applications</li>
                    <li>{summary().preRegistrations} pre-registrations</li>
                  </ul>
                  <p class="text-xs text-muted-foreground">
                    Skipped: {summary().members} members, {summary().devices} device assignments,{" "}
                    {summary().certificates} certificates, {summary().auditLog} audit entries.
                  </p>
                </div>
              )}
            </Show>
            <ErrorText error={importError()} />
          </Show>
          <Show when={importResult()}>
            {(result) => (
              <div class="space-y-2 rounded-lg border border-success/25 bg-success/[0.07] p-3 text-sm">
                <p class="font-medium text-success-foreground">Imported {result().slug}</p>
                <p class="text-muted-foreground">
                  {result().counts.groups} groups, {result().counts.policies} policies,{" "}
                  {result().counts.applications} applications and {result().counts.preRegistrations}{" "}
                  pre-registrations.
                </p>
                <Show when={result().applicationsWithoutFiles > 0}>
                  <p class="text-xs text-muted-foreground">
                    {result().applicationsWithoutFiles} uploaded application
                    {result().applicationsWithoutFiles === 1 ? "" : "s"} need the file re-uploaded.
                  </p>
                </Show>
              </div>
            )}
          </Show>
          <DialogFooter>
            <Show
              when={importResult()}
              fallback={
                <>
                  <Button variant="outline" onClick={() => setImportOpen(false)}>
                    Cancel
                  </Button>
                  <Button
                    disabled={!importBundle() || importing()}
                    onClick={() => void runImport()}
                  >
                    {importing() ? "Importing…" : "Import tenant"}
                  </Button>
                </>
              }
            >
              <Button variant="outline" onClick={() => setImportOpen(false)}>
                Close
              </Button>
              <Button onClick={() => navigate(`/t/${importResult()!.tenantId}/settings`)}>
                Open imported tenant
              </Button>
            </Show>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={restoreTarget() !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRestoreTarget(null);
            setRestoreResult(null);
            setRestoreConfirm("");
            setBackupActionError(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Restore this backup?</DialogTitle>
            <DialogDescription>
              {restoreTarget()
                ? `Backup from ${new Date(restoreTarget()!.startedAt).toLocaleString()} replaces this tenant's groups, policies, applications and pre-registrations. Members, devices, certificates and audit history are kept, and a pinned snapshot is taken before anything changes.`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <Show
            when={restoreResult()}
            fallback={
              <>
                <p class="text-xs leading-relaxed text-muted-foreground">
                  Type the tenant slug{" "}
                  <span class="font-mono font-medium">{tenant.data?.slug}</span> to confirm.
                </p>
                <Input
                  value={restoreConfirm()}
                  onInput={(e) => setRestoreConfirm(e.currentTarget.value)}
                  placeholder={tenant.data?.slug}
                />
                <ErrorText error={backupActionError()} />
              </>
            }
          >
            {(result) => (
              <div class="space-y-2 rounded-lg border border-success/25 bg-success/[0.07] p-3 text-sm">
                <p class="font-medium text-success-foreground">Backup restored</p>
                <p class="text-muted-foreground">
                  {result().counts.groups} groups, {result().counts.policies} policies,{" "}
                  {result().counts.applications} applications, {result().counts.preRegistrations}{" "}
                  pre-registrations and {result().counts.devices} device assignments.
                </p>
                <p class="text-xs text-muted-foreground">
                  A pinned pre-restore snapshot was saved as{" "}
                  <code>{result().preRestoreBackupId}</code>. Restore it if this was the wrong
                  backup.
                </p>
              </div>
            )}
          </Show>
          <DialogFooter>
            <Show
              when={restoreResult()}
              fallback={
                <>
                  <Button variant="outline" onClick={() => setRestoreTarget(null)}>
                    Cancel
                  </Button>
                  <Button
                    disabled={
                      !restoreTarget() ||
                      restoreConfirm() !== tenant.data?.slug ||
                      restoreBackup.isPending
                    }
                    onClick={() => {
                      const target = restoreTarget();

                      if (!target) return;

                      restoreBackup.mutate({ id: target.id, confirm: restoreConfirm() });
                    }}
                  >
                    {restoreBackup.isPending ? "Restoring…" : "Restore backup"}
                  </Button>
                </>
              }
            >
              <Button onClick={() => setRestoreTarget(null)}>Close</Button>
            </Show>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteBackupTarget() !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteBackupTarget(null);
        }}
        title="Delete this backup?"
        description={
          deleteBackupTarget()
            ? `The backup from ${new Date(deleteBackupTarget()!.startedAt).toLocaleString()} and its stored object are removed permanently.`
            : ""
        }
        confirmLabel="Delete backup"
        destructive
        pending={removeBackup.isPending}
        onConfirm={() => {
          const target = deleteBackupTarget();

          if (target) removeBackup.mutate(target.id);
        }}
      />

      <Show when={canDelete()}>
        <Panel
          class="border-destructive/20 bg-destructive/[0.015] xl:col-span-2"
          header={
            <div class="flex items-center gap-2">
              <TriangleAlert class="size-4 text-destructive" />
              <h2 class="text-[13px] font-semibold text-destructive">Danger zone</h2>
            </div>
          }
        >
          <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div class="min-w-0">
              <p class="text-[13px] font-medium text-foreground">Delete this tenant</p>
              <p class="mt-1 text-xs leading-relaxed text-muted-foreground">
                Enrolled devices are sent their platform's unenroll request, the billing
                subscription is cancelled, all tenant files and backups are deleted, then the tenant
                is removed. Offline and Windows devices usually still need manual removal; the
                result lists every device that could not be fully released.
              </p>
              <ErrorText error={del.error} />
            </div>
            <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
              Delete tenant
            </Button>
          </div>
        </Panel>

        <Dialog
          open={deleteOpen()}
          onOpenChange={(open) => {
            setDeleteOpen(open);

            if (!open && deleteResult()) navigate("/dashboard");
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete {tenant.data?.name ?? "tenant"}?</DialogTitle>
              <DialogDescription>
                Devices get an unenroll request, billing is cancelled, and every file and backup is
                deleted before the tenant is removed. If any step fails, the tenant is kept so you
                can retry. Type the tenant slug{" "}
                <span class="font-mono font-medium">{tenant.data?.slug}</span> to confirm.
              </DialogDescription>
            </DialogHeader>
            <Show
              when={deleteResult()}
              fallback={
                <>
                  <Input
                    value={confirm()}
                    onInput={(e) => setConfirm(e.currentTarget.value)}
                    placeholder={tenant.data?.slug}
                  />
                  <ErrorText error={del.error} />
                </>
              }
            >
              {(result) => (
                <div class="space-y-2 rounded-lg border border-white/[0.07] bg-white/[0.02] p-3 text-sm">
                  <p class="font-medium text-success-foreground">Tenant deleted</p>
                  <p class="text-muted-foreground">
                    {result().reclaimed.contacted} of {result().reclaimed.devices} enrolled device
                    {result().reclaimed.devices === 1 ? "" : "s"} contacted,{" "}
                    {result().reclaimed.objects} stored object
                    {result().reclaimed.objects === 1 ? "" : "s"} deleted,{" "}
                    {Match.value(result().reclaimed.subscription).pipe(
                      Match.when("cancelled", () => "subscription cancelled"),
                      Match.when("at_period_end", () => "subscription ends at period end"),
                      Match.orElse(() => "no billing subscription"),
                    )}
                    .
                  </p>
                  <Show when={result().reclaimed.unreachableDevices.length > 0}>
                    <div class="space-y-1">
                      <p class="text-xs font-medium text-destructive">
                        These devices could not be reached and still need manual removal:
                      </p>
                      <ul class="space-y-1 text-xs text-muted-foreground">
                        {result().reclaimed.unreachableDevices.map((device) => (
                          <li>
                            <span class="font-medium text-foreground">{device.name}</span> (
                            {device.platform}) — {device.reason}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </Show>
                </div>
              )}
            </Show>
            <DialogFooter>
              <Show
                when={deleteResult()}
                fallback={
                  <>
                    <Button variant="outline" onClick={() => setDeleteOpen(false)}>
                      Cancel
                    </Button>
                    <Button
                      variant="destructive"
                      disabled={confirm() !== tenant.data?.slug || del.isPending}
                      onClick={() => del.mutate()}
                    >
                      {del.isPending ? "Deleting…" : "Delete tenant"}
                    </Button>
                  </>
                }
              >
                <Button onClick={() => navigate("/dashboard")}>Go to dashboard</Button>
              </Show>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </Show>
    </div>
  );
}

/** A form row in the OpenCode-console style: label and hint on the left, the
 * control pinned to the right on desktop and stacked on narrow screens. */
function FieldRow(props: { label: string; hint?: string; children: JSX.Element }) {
  return (
    <label class="flex flex-col gap-2 py-3.5 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-8">
      <span class="min-w-0">
        <span class="block text-[13px] font-medium leading-snug text-foreground">
          {props.label}
        </span>
        <Show when={props.hint}>
          <span class="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
            {props.hint}
          </span>
        </Show>
      </span>
      <span class="w-full min-w-0 sm:w-[19rem] sm:shrink-0">{props.children}</span>
    </label>
  );
}

function DetailRow(props: { label: string; children: JSX.Element }) {
  return (
    <div class="flex items-start justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
      <span class="shrink-0 text-xs text-muted-foreground">{props.label}</span>
      <span class="min-w-0 text-right">{props.children}</span>
    </div>
  );
}

const chipTones = {
  neutral: "border-white/[0.08] bg-white/[0.03] text-muted-foreground",
  success: "border-success/25 bg-success/10 text-success-foreground",
  warning: "border-warning/25 bg-warning/10 text-warning-foreground",
  danger: "border-destructive/25 bg-destructive/10 text-destructive",
} as const;

function StatusChip(props: { tone: keyof typeof chipTones; children: JSX.Element }) {
  return (
    <span
      class={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize",
        chipTones[props.tone],
      )}
    >
      <span class="size-1.5 rounded-full bg-current" aria-hidden="true" />
      {props.children}
    </span>
  );
}
