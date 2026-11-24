import { useLocation, useParams } from "@solidjs/router";
import type { RoutePreloadFuncArgs } from "@solidjs/router";
import { useQueryClient } from "@tanstack/solid-query";
import { Option, Schema } from "effect";
import { createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js";
import {
  TENANT_IMPORT_MAX_BYTES,
  TenantExportEnvelope,
  TenantImportRequest as TenantImportRequestSchema,
} from "@mattrax/enterprise-domain/client";
import type { TenantImportRequest, TenantImportResponse } from "@mattrax/enterprise-domain/client";
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
import { useTenantProfileDraft } from "~/components/settings/tenant-profile-draft";
import { enterprise, enterpriseKeys, enterpriseQueries } from "~/lib/enterprise";
import { preloadSettingsPage } from "~/components/settings/preload";
import { queryClient } from "~/lib/query-client";
import { AccessDenied, useCan } from "~/lib/permissions";
import { responseFailure } from "~/components/settings/http-failure";
import { downloadBlob } from "~/lib/download";
import { scrollToHashTarget } from "~/lib/hash-scroll";

import { useNavigate } from "~/lib/navigation";
import { CutoverPanel } from "../cutover-panel";

export const route = {
  preload: (args: RoutePreloadFuncArgs) =>
    preloadSettingsPage(args, [
      {
        // The layout disables the tenant query without tenant.read; only warm
        // it when the role can actually read the tenant.
        permission: "tenant.read",
        load: async () => {
          await queryClient.ensureQueryData(enterpriseQueries.tenant(args.params.tenantId));
        },
      },
    ]),
};

const decodeTenantImport = Schema.decodeUnknownOption(TenantImportRequestSchema);

/**
 * Settings → Migration → Export / import.
 *
 * The plain tenant bundle moves configuration between deployments; the cutover
 * panel below it also carries device identities. Both were on General before,
 * where they crowded the profile form.
 */
export default function MigrationExportPage() {
  const params = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { can } = useCan();
  const { tenant } = useTenantProfileDraft();
  const canExport = () => can("tenant.export");
  const canImport = () => can("tenant.import");
  const canOpen = () => canExport() || canImport();

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

  // Import used to be General's `#restore` anchor. The settings pane resets
  // its scrollport when the pathname changes, and on a cold load the browser
  // looks for the fragment before this section exists. Wait a frame so the
  // reset has run, then scroll to the import section ourselves.
  let restoreFrame: number | undefined;
  createEffect(
    () => location.hash,
    (hash) => {
      if (hash !== "#restore" || typeof document === "undefined") return;

      if (restoreFrame !== undefined) cancelAnimationFrame(restoreFrame);

      restoreFrame = requestAnimationFrame(() => {
        restoreFrame = undefined;
        scrollToHashTarget(hash, (id) => document.getElementById(id));
      });
    },
  );
  onCleanup(() => {
    if (restoreFrame !== undefined) cancelAnimationFrame(restoreFrame);
  });

  const download = (body: string, filename: string) =>
    downloadBlob(new Blob([body], { type: "application/json" }), filename);

  const exportTenant = async () => {
    setExporting(true);
    setExportError(undefined);

    try {
      const response = await enterprise.exportTenantDownload(params.tenantId, includeAudit());

      if (!response.ok)
        throw await responseFailure(response, "Export failed (" + response.status + ")");
      const disposition = response.headers.get("Content-Disposition") ?? "";
      const filename =
        /filename="([^"]+)"/.exec(disposition)?.[1] ??
        "tenant-" + (tenant.data?.slug ?? params.tenantId ?? "export") + ".json";

      const body = await response.text();
      Schema.decodeUnknownSync(TenantExportEnvelope)(JSON.parse(body));
      download(body, filename);
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

  if (!canOpen())
    return (
      <AccessDenied
        title="No tenant transfer access"
        message="Your role cannot export or import tenants. Ask a tenant owner for the tenant.export or tenant.import permission."
      />
    );

  return (
    <div class="grid gap-5">
      <QueryError error={tenant.error} onRetry={() => void tenant.refetch()} />

      <Panel
        title="Tenant bundle"
        description="Versioned JSON bundles for moving a tenant between deployments."
      >
        <div class="divide-y divide-border">
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
                  Your role cannot export tenant data. Ask a tenant owner for the tenant.export
                  permission.
                </p>
              </Show>
              <ErrorText error={exportError()} />
            </div>
            <div class="shrink-0">
              <Button
                variant="outline"
                onClick={() => void exportTenant()}
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
        </div>
      </Panel>

      <CutoverPanel tenant={tenant.data} />

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
                <div class="space-y-2 rounded-lg border border-border bg-surface p-3 text-sm">
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
                <p class="font-medium text-success">Imported {result().slug}</p>
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
    </div>
  );
}
