import { useNavigate, useParams } from "@solidjs/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { createEffect, createMemo, createSignal, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import {
  DEFAULT_BRAND_COLOR,
  isLogoUrl,
  normalizeBrandColor,
  resolveTenantBranding,
  TENANT_IMPORT_MAX_BYTES,
  validateTenantBranding,
  type TenantImportRequest,
  type TenantImportResponse,
} from "@mattrax/enterprise-domain";
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
import { enterprise, enterpriseKeys } from "~/lib/enterprise";
import { cn } from "~/lib/utils";
import { withStepUp } from "~/lib/step-up";

export default function GeneralSettingsPage() {
  const params = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
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
      await qc.invalidateQueries({ queryKey: enterpriseKeys.tenant(params.tenantId) });
      await qc.invalidateQueries({ queryKey: enterpriseKeys.me() });
    },
  }));
  const del = useMutation(() => ({
    mutationFn: () => enterprise.deleteTenant(params.tenantId),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: enterpriseKeys.me() });
      navigate("/dashboard");
    },
  }));

  const isOwner = () => (tenant.data?.role ?? "").split(",").includes("owner");
  // Non-owners get a 403 from the API and the card stays hidden; avoiding an
  // `enabled` gate keeps query options out of a pending tenant-query read.
  const backups = useQuery(() => ({
    queryKey: enterpriseKeys.backups(params.tenantId),
    queryFn: () => enterprise.listTenantBackups(params.tenantId),
    // Non-owners get a 403; do not retry it three times on every visit.
    retry: false,
  }));
  const [backupDownloadError, setBackupDownloadError] = createSignal<unknown>(null);
  const backupNow = useMutation(() => ({
    mutationFn: () => enterprise.runTenantBackup(params.tenantId),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: enterpriseKeys.backups(params.tenantId) });
    },
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
            ...(grant ? { headers: { "x-mattrax-step-up": grant } } : {}),
          },
        );
        if (result.status === 403) {
          const body = (await result.json().catch(() => null)) as {
            _tag?: string;
            action?: string;
            methods?: string[];
          } | null;
          if (body?._tag === "StepUpRequired") throw body;
        }
        return result;
      });
      if (!response.ok)
        throw new Error((await response.text()) || `Download failed (${response.status})`);
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
      if (!response.ok)
        throw new Error((await response.text()) || `Export failed (${response.status})`);
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
      const parsed = JSON.parse(await file.text()) as TenantImportRequest;
      if (
        !parsed ||
        typeof parsed !== "object" ||
        typeof parsed.version !== "number" ||
        !parsed.tenant
      )
        throw new Error("This file is not a Mattrax tenant bundle.");
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
              <Input value={name()} onInput={(e) => setName(e.currentTarget.value)} required />
            </FieldRow>
            <FieldRow label="Slug" hint="Used in URLs and when generating identifiers.">
              <Input
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
                  class="h-8 w-11 shrink-0 cursor-pointer rounded-md border border-input bg-white/[0.03] p-1"
                  value={colorValue()}
                  onInput={(e) => setBrandColor(e.currentTarget.value)}
                />
                <Input
                  aria-label="Brand colour hex value"
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
            <Button type="submit" class="ml-auto" disabled={save.isPending || hasBrandingErrors()}>
              {save.isPending ? "Saving…" : "Save changes"}
            </Button>
          </div>
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
                  class="break-all underline underline-offset-2"
                  style={{ color: preview().brandColor }}
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
              <span class="font-medium capitalize text-foreground">{tenant.data?.role ?? "…"}</span>
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
              <Show when={tenant.data && !isOwner()}>
                <p class="mt-2 text-xs text-muted-foreground">
                  Only the tenant owner can export or import tenant data.
                </p>
              </Show>
              <ErrorText error={exportError()} />
            </div>
            <div class="shrink-0">
              <Button variant="outline" onClick={exportTenant} disabled={!isOwner() || exporting()}>
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
              <Button variant="outline" onClick={openImport} disabled={!isOwner()}>
                Import tenant
              </Button>
            </div>
          </section>

          <Show when={isOwner()}>
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
                  disabled={!isOwner() || backupNow.isPending}
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
                              tone={
                                run.status === "succeeded"
                                  ? "success"
                                  : run.status === "failed"
                                    ? "danger"
                                    : "warning"
                              }
                            >
                              {run.status}
                            </StatusChip>
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
                            <Show when={run.status === "succeeded"}>
                              <button
                                type="button"
                                class="text-xs font-medium text-foreground underline decoration-white/25 underline-offset-2 transition-colors hover:decoration-white/60"
                                onClick={() => void downloadBackup(run.id)}
                              >
                                Download
                              </button>
                            </Show>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Show>

              <p class="mt-3 text-xs leading-relaxed text-muted-foreground">
                Backups older than the configured retention window are deleted automatically. Need
                to restore?{" "}
                <a
                  class="text-foreground underline decoration-white/25 underline-offset-2 transition-colors hover:decoration-white/60"
                  href="#restore"
                >
                  Import a bundle
                </a>
                .
              </p>
            </section>
          </Show>
        </div>
      </Panel>

      <input
        ref={importFileInput}
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
              Devices are sent an unenroll request and all tenant data is permanently removed.
            </p>
            <ErrorText error={del.error} />
          </div>
          <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
            Delete tenant
          </Button>
        </div>
      </Panel>

      <Dialog open={deleteOpen()} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {tenant.data?.name ?? "tenant"}?</DialogTitle>
            <DialogDescription>
              This cannot be undone. Type the tenant slug{" "}
              <span class="font-mono font-medium">{tenant.data?.slug}</span> to confirm.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={confirm()}
            onInput={(e) => setConfirm(e.currentTarget.value)}
            placeholder={tenant.data?.slug}
          />
          <ErrorText error={del.error} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={confirm() !== tenant.data?.slug || del.isPending}
              onClick={() => del.mutate()}
            >
              Delete tenant
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
