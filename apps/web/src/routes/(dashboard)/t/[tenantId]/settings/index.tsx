import { useNavigate, useParams } from "@solidjs/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { createEffect, createMemo, createSignal, Show } from "solid-js";
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
import { ErrorText, Field, QueryError } from "~/components/mdm/common";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { enterprise, enterpriseKeys } from "~/lib/enterprise";
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
    <div class="grid gap-6 xl:grid-cols-2">
      <QueryError
        class="xl:col-span-2"
        error={tenant.error}
        onRetry={() => void tenant.refetch()}
      />
      <Card>
        <CardHeader>
          <CardTitle>Tenant profile</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            class="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              save.mutate();
            }}
          >
            <Field label="Name" hint="Internal tenant name used by the dashboard.">
              <Input value={name()} onInput={(e) => setName(e.currentTarget.value)} required />
            </Field>
            <Field label="Slug" hint="Used in URLs and when generating identifiers.">
              <Input
                value={slug()}
                pattern="[a-z0-9-]+"
                onInput={(e) => setSlug(e.currentTarget.value.toLowerCase())}
                required
              />
            </Field>
            <Field
              label="Display name"
              hint="Shown on the enrollment page, Apple profile and tenant emails. Falls back to the name above."
            >
              <Input
                value={displayName()}
                placeholder={name() || "Mattrax"}
                onInput={(e) => setDisplayName(e.currentTarget.value)}
              />
              <Show when={brandingErrors().displayName}>
                <p class="text-xs text-red-600">{brandingErrors().displayName}</p>
              </Show>
            </Field>
            <Field
              label="Logo"
              hint="An https URL, an inline data: image URL, or an absolute path."
            >
              <Input
                value={logo()}
                placeholder="https://example.com/logo.png"
                onInput={(e) => setLogo(e.currentTarget.value)}
              />
              <Show when={brandingErrors().logo}>
                <p class="text-xs text-red-600">{brandingErrors().logo}</p>
              </Show>
            </Field>
            <Field label="Support email" hint="Shown to people enrolling a device.">
              <Input
                type="email"
                value={supportEmail()}
                placeholder="hello@mattrax.app"
                onInput={(e) => setSupportEmail(e.currentTarget.value)}
              />
              <Show when={brandingErrors().supportEmail}>
                <p class="text-xs text-red-600">{brandingErrors().supportEmail}</p>
              </Show>
            </Field>
            <Field label="Brand colour" hint="Used for accents on the public enrollment page.">
              <div class="flex items-center gap-2">
                <input
                  type="color"
                  aria-label="Brand colour picker"
                  class="h-9 w-12 cursor-pointer rounded-md border bg-white p-1"
                  value={colorValue()}
                  onInput={(e) => setBrandColor(e.currentTarget.value)}
                />
                <Input
                  value={brandColor()}
                  placeholder={DEFAULT_BRAND_COLOR}
                  onInput={(e) => setBrandColor(e.currentTarget.value)}
                />
              </div>
              <Show when={brandingErrors().brandColor}>
                <p class="text-xs text-red-600">{brandingErrors().brandColor}</p>
              </Show>
            </Field>
            <ErrorText error={save.error} />
            <div class="flex items-center gap-2">
              <Button type="submit" disabled={save.isPending || hasBrandingErrors()}>
                {save.isPending ? "Saving…" : "Save changes"}
              </Button>
              <Show when={tenant.data}>
                <span class="text-xs text-muted-foreground">
                  Created {new Date(tenant.data!.createdAt).toLocaleDateString()}
                </span>
              </Show>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Branding preview</CardTitle>
        </CardHeader>
        <CardContent class="space-y-4">
          <div class="overflow-hidden rounded-xl border">
            <div class="h-2" style={{ "background-color": preview().brandColor }} />
            <div class="space-y-4 p-5">
              <div class="flex items-center gap-3">
                <Show when={preview().logo && isLogoUrl(preview().logo!)}>
                  <img src={preview().logo!} alt="" class="size-10 rounded-md object-contain" />
                </Show>
                <div>
                  <p class="text-base font-semibold text-stone-900">
                    Enroll in {preview().displayName}
                  </p>
                  <p class="text-xs text-muted-foreground">Device enrollment</p>
                </div>
              </div>
              <div
                class="rounded-lg px-3 py-2 text-center text-sm font-medium text-white"
                style={{ "background-color": preview().brandColor }}
              >
                Continue
              </div>
              <p class="text-xs text-muted-foreground">
                Need help? Contact{" "}
                <a
                  class="underline"
                  style={{ color: preview().brandColor }}
                  href={`mailto:${preview().supportEmail}`}
                >
                  {preview().supportEmail}
                </a>
              </p>
            </div>
          </div>
          <p class="text-xs text-muted-foreground">
            This preview uses the values above before you save. Unset values fall back to the
            Mattrax defaults.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tenant details</CardTitle>
        </CardHeader>
        <CardContent class="space-y-3 text-sm">
          <Row label="Tenant ID" value={params.tenantId ?? ""} mono />
          <Row label="Your role" value={tenant.data?.role ?? "…"} />
          <Row label="Devices" value="Managed from the Devices page" />
          <p class="pt-2 text-xs text-muted-foreground">
            Tenant resources (devices, groups, policies, members) are isolated from every other
            tenant.
          </p>
        </CardContent>
      </Card>

      <Card class="xl:col-span-2">
        <CardHeader>
          <CardTitle>Data and backups</CardTitle>
        </CardHeader>
        <CardContent class="grid gap-6 lg:grid-cols-2">
          <div class="space-y-3">
            <p class="text-sm font-medium">Export tenant</p>
            <p class="text-sm text-muted-foreground">
              Download a versioned JSON bundle containing this tenant's profile and branding,
              groups, policies and configurations, application metadata, enrollment settings and
              pre-registrations. APNs/SCEP private keys, token hashes, passwords, sessions and
              stored object bytes are never included.
            </p>
            <label class="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={includeAudit()}
                onChange={(event) => setIncludeAudit(event.currentTarget.checked)}
              />
              Include the audit log (up to 10,000 recent entries)
            </label>
            <Button variant="outline" onClick={exportTenant} disabled={!isOwner() || exporting()}>
              {exporting() ? "Preparing…" : "Export tenant"}
            </Button>
            <Show when={tenant.data && !isOwner()}>
              <p class="text-xs text-muted-foreground">
                Only the tenant owner can export or import tenant data.
              </p>
            </Show>
            <ErrorText error={exportError()} />
          </div>
          <div class="space-y-3" id="restore">
            <p class="text-sm font-medium">Import tenant</p>
            <p class="text-sm text-muted-foreground">
              Create a new tenant owned by you from a previously exported bundle. Internal ids are
              re-mapped, a free slug is chosen automatically, and the import is applied as one
              transaction.
            </p>
            <p class="text-xs text-muted-foreground">
              Members, devices, audit history and SCEP certificates are not imported. Uploaded
              application files must be re-uploaded after import.
            </p>
            <Button variant="outline" onClick={openImport} disabled={!isOwner()}>
              Import tenant
            </Button>
          </div>
          <Show when={isOwner()}>
            <div class="space-y-3 lg:col-span-2">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <p class="text-sm font-medium">Automatic tenant backups</p>
                <Button
                  variant="outline"
                  onClick={() => backupNow.mutate()}
                  disabled={!isOwner() || backupNow.isPending}
                >
                  {backupNow.isPending ? "Backing up…" : "Back up now"}
                </Button>
              </div>
              <p class="text-sm text-muted-foreground">
                A JSON bundle is written to private object storage every day and after manual runs.
                Bundles use the same shape as the export above: credentials, private keys, token
                hashes and object bytes are never included. Downloads are authenticated and go
                through the API; the R2 object is never public. Restore by downloading a backup and
                importing it as a new tenant below.
              </p>
              <Show when={backups.isError || backupNow.isError}>
                <ErrorText error={backups.error ?? backupNow.error} />
              </Show>
              <Show when={backupDownloadError()}>{(error) => <ErrorText error={error()} />}</Show>
              <Show when={latestBackup()}>
                {(latest) => (
                  <div class="rounded-lg border bg-stone-50 p-3 text-sm">
                    <div class="flex flex-wrap items-center justify-between gap-2">
                      <span>
                        Last backup:{" "}
                        <span class="font-medium">
                          {latest().status === "succeeded" ? "Succeeded" : latest().status}
                        </span>{" "}
                        <span class="text-muted-foreground">
                          {new Date(latest().startedAt).toLocaleString()}
                        </span>
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
                      <p class="mt-1 text-xs text-red-600">{latest().error}</p>
                    </Show>
                  </div>
                )}
              </Show>
              <Show when={backupWarning()}>
                {(warning) => (
                  <p
                    class={
                      latestBackup()?.status === "failed"
                        ? "rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
                        : "rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
                    }
                  >
                    {warning()}
                  </p>
                )}
              </Show>
              <Show when={(backups.data?.backups ?? []).length > 0}>
                <div class="overflow-hidden rounded-lg border">
                  <table class="w-full text-left text-xs">
                    <thead class="bg-stone-50 text-muted-foreground">
                      <tr>
                        <th class="px-3 py-2 font-medium">Started</th>
                        <th class="px-3 py-2 font-medium">Trigger</th>
                        <th class="px-3 py-2 font-medium">Status</th>
                        <th class="px-3 py-2 font-medium">Size</th>
                        <th class="px-3 py-2 font-medium" />
                      </tr>
                    </thead>
                    <tbody>
                      {(backups.data?.backups ?? []).slice(0, 8).map((run) => (
                        <tr class="border-t">
                          <td class="px-3 py-2">{new Date(run.startedAt).toLocaleString()}</td>
                          <td class="px-3 py-2 capitalize">{run.trigger}</td>
                          <td class="px-3 py-2">
                            <span
                              class={
                                run.status === "succeeded"
                                  ? "text-emerald-700"
                                  : run.status === "failed"
                                    ? "text-red-700"
                                    : "text-amber-700"
                              }
                            >
                              {run.status}
                            </span>
                            <Show when={run.error}>
                              <span class="ml-1 text-red-600" title={run.error ?? ""}>
                                ({run.error?.slice(0, 60)})
                              </span>
                            </Show>
                          </td>
                          <td class="px-3 py-2">{formatBackupSize(run.sizeBytes)}</td>
                          <td class="px-3 py-2 text-right">
                            <Show when={run.status === "succeeded"}>
                              <button
                                type="button"
                                class="underline"
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
              <p class="text-xs text-muted-foreground">
                Backups older than the configured retention window are deleted automatically. Need
                to restore?{" "}
                <a class="underline" href="#restore">
                  Import a bundle
                </a>
                .
              </p>
            </div>
          </Show>
        </CardContent>
      </Card>

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
                <span class="text-xs text-muted-foreground">{importFileName()}</span>
              </Show>
            </div>
            <Show when={importSummary()}>
              {(summary) => (
                <div class="space-y-2 rounded-lg border bg-stone-50 p-3 text-sm">
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
              <div class="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
                <p class="font-medium">Imported {result().slug}</p>
                <p>
                  {result().counts.groups} groups, {result().counts.policies} policies,{" "}
                  {result().counts.applications} applications and {result().counts.preRegistrations}{" "}
                  pre-registrations.
                </p>
                <Show when={result().applicationsWithoutFiles > 0}>
                  <p class="text-xs">
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

      <Card class="border-red-200 xl:col-span-2">
        <CardHeader>
          <CardTitle class="text-red-700">Danger zone</CardTitle>
        </CardHeader>
        <CardContent class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p class="text-sm font-medium">Delete this tenant</p>
            <p class="text-sm text-muted-foreground">
              Devices are sent an unenroll request and all tenant data is permanently removed.
            </p>
            <ErrorText error={del.error} />
          </div>
          <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
            Delete tenant
          </Button>
        </CardContent>
      </Card>

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

function Row(props: { label: string; value: string; mono?: boolean }) {
  return (
    <div class="flex items-center justify-between gap-4">
      <span class="text-muted-foreground">{props.label}</span>
      <span class={props.mono ? "truncate font-mono text-xs" : "text-right font-medium"}>
        {props.value}
      </span>
    </div>
  );
}
