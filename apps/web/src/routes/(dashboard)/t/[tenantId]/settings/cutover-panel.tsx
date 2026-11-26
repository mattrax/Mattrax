import { createMemo, createSignal, For, Show } from "solid-js";
import { useParams } from "@solidjs/router";
import { useQuery, useQueryClient } from "@tanstack/solid-query";
import type { CutoverImportResponse, CutoverPreview } from "@mattrax/enterprise-domain/client";
import { ErrorText, Panel } from "~/components/mdm/common";
import { Button } from "~/components/ui/button";
import { Checkbox } from "@mattrax/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { CircleAlert, CheckCircle2, Download, ShieldCheck } from "~/components/ui/icons";
import { useNavigate } from "~/lib/navigation";
import { enterprise, enterpriseKeys } from "~/lib/enterprise";
import type { TenantDetail } from "~/lib/enterprise";
import { downloadBlob } from "~/lib/download";
import { useCan } from "~/lib/permissions";
import { cn } from "~/lib/utils";
import { resolveTenantId } from "~/lib/tenant";

const MIN_PASSPHRASE = 12;

const origin = () => (typeof window === "undefined" ? "" : window.location.origin);

const bytes = (value: number) => (value < 1024 ? `${value} B` : `${(value / 1024).toFixed(1)} KB`);

const severityClass = {
  ok: "border-success/25 bg-success/[0.06] text-success",
  info: "border-border bg-surface text-muted-foreground",
  warning: "border-warning/25 bg-warning/[0.07] text-warning-foreground",
  blocker: "border-destructive/25 bg-destructive/[0.07] text-destructive",
} satisfies Record<string, string>;

const Toggle = (props: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hint: string;
  disabled?: boolean;
}) => (
  <label class="flex items-start gap-2.5 py-2">
    <Checkbox
      class="mt-0.5"
      checked={props.checked}
      disabled={props.disabled}
      onCheckedChange={(checked) => props.onChange(checked === true)}
    />
    <span class="min-w-0">
      <span class="block text-xs font-medium text-foreground">{props.label}</span>
      <span class="block text-xs leading-relaxed text-muted-foreground">{props.hint}</span>
    </span>
  </label>
);

/**
 * Export / move deployment.
 *
 * A cutover archive is not a backup: it carries device identities, the tenant
 * SCEP CA and escrowed secrets so enrolled devices keep checking in after DNS
 * and ORIGIN move. Every download and import is step-up gated and
 * permission-gated; the passphrase never leaves this component except in the
 * request body.
 */
export default function CutoverPanel(props: { tenant: TenantDetail | undefined }) {
  const params = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { can } = useCan();
  const tenantId = () => resolveTenantId(params.tenantId) ?? "";

  const canExport = () => can("tenant.export");
  const canImport = () => can("tenant.import");

  const [includeMembers, setIncludeMembers] = createSignal(true);
  const [includeDevices, setIncludeDevices] = createSignal(true);
  const [includeScepCa, setIncludeScepCa] = createSignal(true);
  const [includeAudit, setIncludeAudit] = createSignal(false);

  const [passphrase, setPassphrase] = createSignal("");
  const [passphraseConfirm, setPassphraseConfirm] = createSignal("");
  const [exporting, setExporting] = createSignal(false);
  const [exportError, setExportError] = createSignal<unknown>();

  const [exported, setExported] = createSignal<{ bytes: number } | null>(null);

  const [preflightOrigin, setPreflightOrigin] = createSignal(origin());
  const [preflight, setPreflight] = createSignal(false);

  const preflightQuery = useQuery(() => ({
    queryKey: ["tenant", tenantId(), "cutover-preflight", preflightOrigin()],
    queryFn: () =>
      enterprise.getTenantCutoverPreflight(tenantId(), {
        origin: preflightOrigin() || undefined,
      }),
    enabled: preflight() && canExport(),
    retry: false,
  }));

  const passphraseProblem = createMemo(() => {
    if (!passphrase()) return null;

    if (passphrase().length < MIN_PASSPHRASE) return `Use at least ${MIN_PASSPHRASE} characters.`;

    if (passphrase() !== passphraseConfirm()) return "The passphrases do not match.";

    return null;
  });

  const download = async () => {
    setExporting(true);
    setExportError(undefined);
    setExported(null);

    try {
      const archive = await enterprise.exportTenantCutover(tenantId(), {
        passphrase: passphrase(),
        sections: {
          members: includeMembers(),
          devices: includeDevices(),
          scepCa: includeScepCa(),
          audit: includeAudit(),
        },
      });

      const slug = props.tenant?.slug ?? "tenant";
      const date = new Date().toISOString().slice(0, 10);

      downloadBlob(
        new Blob([archive], { type: "application/json" }),
        `tenant-${slug}-cutover-${date}.cutover.json`,
      );

      setExported({ bytes: new TextEncoder().encode(archive).byteLength });
      setPassphrase("");
      setPassphraseConfirm("");
    } catch (error) {
      setExportError(error);
    } finally {
      setExporting(false);
    }
  };

  const [importOpen, setImportOpen] = createSignal(false);
  const [archive, setArchive] = createSignal("");
  const [archiveName, setArchiveName] = createSignal("");
  const [importPassphrase, setImportPassphrase] = createSignal("");
  const [targetExisting, setTargetExisting] = createSignal(false);
  const [preview, setPreview] = createSignal<CutoverPreview | null>(null);
  const [previewError, setPreviewError] = createSignal<unknown>();
  const [previewing, setPreviewing] = createSignal(false);
  const [confirm, setConfirm] = createSignal("");
  const [allowCrossDeployment, setAllowCrossDeployment] = createSignal(false);
  const [replaceConfiguration, setReplaceConfiguration] = createSignal(false);
  const [replaceScepCa, setReplaceScepCa] = createSignal(false);
  const [replaceEscrowKey, setReplaceEscrowKey] = createSignal(false);
  const [deviceConflicts, setDeviceConflicts] = createSignal<"fail" | "skip">("fail");
  const [importing, setImporting] = createSignal(false);
  const [importError, setImportError] = createSignal<unknown>();
  const [result, setResult] = createSignal<CutoverImportResponse | null>(null);

  let fileInput: HTMLInputElement | undefined;

  const resetImport = () => {
    setArchive("");
    setArchiveName("");
    setImportPassphrase("");
    setPreview(null);
    setPreviewError(undefined);
    setImportError(undefined);
    setResult(null);
    setConfirm("");
    setAllowCrossDeployment(false);
    setReplaceConfiguration(false);
    setReplaceScepCa(false);
    setReplaceEscrowKey(false);
    setDeviceConflicts("fail");
    setTargetExisting(false);

    if (fileInput) fileInput.value = "";
  };

  const chooseFile = async (file: File | undefined) => {
    setPreview(null);
    setPreviewError(undefined);
    setResult(null);

    if (!file) {
      setArchive("");
      setArchiveName("");

      return;
    }

    setArchiveName(file.name);
    setArchive(await file.text());
  };

  const runPreview = async () => {
    if (!archive() || !importPassphrase()) return;
    setPreviewing(true);
    setPreviewError(undefined);

    try {
      const value = await enterprise.previewTenantCutover({
        archive: archive(),
        passphrase: importPassphrase(),
        targetTenantId: targetExisting() ? tenantId() : null,
      });

      setPreview(value);
      setAllowCrossDeployment(value.requirements.allowCrossDeployment);
    } catch (error) {
      setPreviewError(error);
    } finally {
      setPreviewing(false);
    }
  };

  const runImport = async () => {
    const current = preview();

    if (!current) return;
    setImporting(true);
    setImportError(undefined);

    try {
      const value = await enterprise.importTenantCutover({
        archive: archive(),
        passphrase: importPassphrase(),
        confirm: confirm(),
        targetTenantId: targetExisting() ? tenantId() : null,
        allowCrossDeployment: allowCrossDeployment(),
        replaceConfiguration: replaceConfiguration(),
        replaceScepCa: replaceScepCa(),
        replaceEscrowKey: replaceEscrowKey(),
        deviceConflicts: deviceConflicts(),
      });

      setResult(value);
      setImportPassphrase("");

      await Promise.all([
        qc.invalidateQueries({ queryKey: enterpriseKeys.tenant(tenantId()) }),
        qc.invalidateQueries({ queryKey: enterpriseKeys.me() }),
      ]);
    } catch (error) {
      setImportError(error);
    } finally {
      setImporting(false);
    }
  };

  const previewCounts = createMemo(() => {
    const value = preview();

    if (!value) return null;

    return [
      `${value.counts.groups} groups`,
      `${value.counts.policies} policies`,
      `${value.counts.applications} applications`,
      `${value.counts.devices} devices`,
      `${value.counts.certificates} certificates`,
      `${value.counts.members} members`,
      `${value.counts.auditEntries} audit entries`,
    ];
  });

  return (
    <Panel
      class="min-w-0"
      title="Export / move deployment"
      description="Move this tenant to another Mattrax deployment without re-enrolling its devices."
    >
      <div class="divide-y divide-border">
        <section class="pb-5">
          <h3 class="text-xs font-semibold text-foreground">Preflight</h3>
          <p class="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">
            Reports what a change of ORIGIN breaks before DNS is touched: installed profiles, SCEP
            renewal URLs, APNs, platform integrations, WebAuthn relying party and pending email
            links.
          </p>
          <div class="mt-3 flex flex-wrap items-end gap-2">
            <label class="min-w-0 flex-1 sm:max-w-sm">
              <span class="mb-1 block text-xs text-muted-foreground">Target origin</span>
              <Input
                value={preflightOrigin()}
                onInput={(event) => setPreflightOrigin(event.currentTarget.value)}
                placeholder="https://mdm.example.com"
              />
            </label>
            <Button variant="outline" disabled={!canExport()} onClick={() => setPreflight(true)}>
              Run preflight
            </Button>
          </div>
          <Show when={preflight()}>
            <Show when={preflightQuery.isError}>
              <div class="mt-3">
                <ErrorText error={preflightQuery.error} />
              </div>
            </Show>
            <Show when={preflightQuery.data}>
              {(report) => (
                <div class="mt-4 space-y-3">
                  <p class="text-xs text-muted-foreground">
                    Current {report().currentOrigin} → target {report().targetOrigin}
                  </p>
                  <ul class="space-y-2">
                    <For each={report().items}>
                      {(item) => (
                        <li class={cn("rounded-lg border px-3 py-2", severityClass[item.severity])}>
                          <div class="flex flex-wrap items-center justify-between gap-2">
                            <span class="text-xs font-medium">{item.title}</span>
                            <span class="text-xs uppercase tracking-widest">
                              {item.severity}
                              <Show when={item.affected !== undefined}>
                                {" · "}
                                {item.affected}
                              </Show>
                            </span>
                          </div>
                          <p class="mt-1 text-xs leading-relaxed">{item.detail}</p>
                        </li>
                      )}
                    </For>
                  </ul>
                  <details class="rounded-lg border border-border bg-surface p-3">
                    <summary class="cursor-pointer text-xs font-medium text-foreground">
                      Cutover sequence
                    </summary>
                    <ol class="mt-2 list-decimal space-y-2 pl-5 text-xs leading-relaxed text-muted-foreground">
                      <For each={report().steps}>
                        {(step) => (
                          <li>
                            <span class="font-medium text-foreground">{step.title}.</span>{" "}
                            {step.detail}
                          </li>
                        )}
                      </For>
                    </ol>
                  </details>
                </div>
              )}
            </Show>
          </Show>
        </section>

        <section class="py-5">
          <h3 class="text-xs font-semibold text-foreground">Encrypted cutover archive</h3>
          <p class="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">
            The archive includes private keys and device credentials, so it is encrypted with your
            passphrase (PBKDF2-SHA256, AES-256-GCM) and never uploaded anywhere. Store it like a
            backup: anyone with the file and the passphrase can impersonate every device.
          </p>
          <div class="mt-3 grid gap-4 lg:grid-cols-2">
            <div class="rounded-lg border border-border bg-surface p-3">
              <p class="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                Included
              </p>
              <Toggle
                checked
                disabled
                onChange={() => undefined}
                label="Configuration"
                hint="Branding, groups, policies, applications, assignments, enrollment and pre-registrations."
              />
              <Toggle
                checked={includeMembers()}
                onChange={setIncludeMembers}
                label="Members and invitations"
                hint="Matched by account email. Missing accounts become pending invitations you resend."
              />
              <Toggle
                checked={includeDevices()}
                onChange={setIncludeDevices}
                label="Devices, identities and escrowed secrets"
                hint="Apple push tokens, Windows device identity, the FileVault escrow key and per-device secrets."
              />
              <Toggle
                checked={includeScepCa()}
                onChange={setIncludeScepCa}
                label="SCEP CA and issued certificates"
                hint="Lets existing identity certificates keep authenticating and renewing."
              />
              <Toggle
                checked={includeAudit()}
                onChange={setIncludeAudit}
                label="Audit history"
                hint="The most recent 10,000 entries, kept for investigation."
              />
            </div>
            <div class="space-y-3">
              <label class="block">
                <span class="mb-1 block text-xs text-muted-foreground">Passphrase</span>
                <Input
                  type="password"
                  autocomplete="new-password"
                  value={passphrase()}
                  onInput={(event) => setPassphrase(event.currentTarget.value)}
                  placeholder={`At least ${MIN_PASSPHRASE} characters`}
                />
              </label>
              <label class="block">
                <span class="mb-1 block text-xs text-muted-foreground">Confirm passphrase</span>
                <Input
                  type="password"
                  autocomplete="new-password"
                  value={passphraseConfirm()}
                  onInput={(event) => setPassphraseConfirm(event.currentTarget.value)}
                />
              </label>
              <Show when={passphraseProblem()}>
                {(problem) => <p class="text-xs text-destructive">{problem()}</p>}
              </Show>
              <Button
                variant="outline"
                disabled={
                  !canExport() || exporting() || Boolean(passphraseProblem()) || !passphrase()
                }
                onClick={() => void download()}
              >
                <Download class="size-4" />
                {exporting() ? "Encrypting…" : "Download archive"}
              </Button>
              <Show when={!canExport()}>
                <p class="text-xs text-muted-foreground">
                  Your role cannot export tenant data, including this archive.
                </p>
              </Show>
              <Show when={exported()}>
                {(value) => (
                  <p role="status" class="flex items-start gap-2 text-xs text-success">
                    <CheckCircle2 class="mt-0.5 size-3.5 shrink-0" />
                    Archive downloaded ({bytes(value().bytes)}). Delete it once every device has
                    checked in.
                  </p>
                )}
              </Show>
              <ErrorText error={exportError()} />
            </div>
          </div>
        </section>

        <section class="pt-5">
          <h3 class="text-xs font-semibold text-foreground">Import a cutover archive</h3>
          <p class="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">
            Creates a new tenant, or replaces this tenant's configuration and device data if you
            choose that explicitly. Nothing is written until you preview the archive, review every
            conflict and type the source tenant slug.
          </p>
          <div class="mt-3">
            <Button
              variant="outline"
              disabled={!canImport()}
              onClick={() => {
                resetImport();
                setImportOpen(true);
              }}
            >
              <ShieldCheck class="size-4" />
              Import archive
            </Button>
            <Show when={!canImport()}>
              <p class="mt-2 text-xs text-muted-foreground">Your role cannot import tenant data.</p>
            </Show>
          </div>
        </section>
      </div>

      <Dialog
        open={importOpen()}
        onOpenChange={(open) => {
          setImportOpen(open);

          if (!open) resetImport();
        }}
      >
        <DialogContent class="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Import a cutover archive</DialogTitle>
            <DialogDescription>
              Verify the archive first. The preview decrypts it locally on the server and lists
              conflicts without writing anything.
            </DialogDescription>
          </DialogHeader>

          <Show when={!result()}>
            <div class="space-y-3">
              <div class="flex flex-wrap items-center gap-2">
                <Button variant="outline" onClick={() => fileInput?.click()}>
                  {archiveName() ? "Choose another archive" : "Choose archive"}
                </Button>
                <Show when={archiveName()}>
                  <span class="min-w-0 break-all text-xs text-muted-foreground">
                    {archiveName()}
                  </span>
                </Show>
              </div>
              <label class="block">
                <span class="mb-1 block text-xs text-muted-foreground">Passphrase</span>
                <Input
                  type="password"
                  autocomplete="off"
                  value={importPassphrase()}
                  onInput={(event) => {
                    setImportPassphrase(event.currentTarget.value);
                    setPreview(null);
                  }}
                />
              </label>
              <label class="flex items-start gap-2 text-xs text-muted-foreground">
                <Checkbox
                  class="mt-0.5"
                  checked={targetExisting()}
                  onCheckedChange={(checked) => {
                    setTargetExisting(checked === true);
                    setPreview(null);
                  }}
                />
                Import into this tenant instead of creating a new one. This replaces its groups,
                policies, applications and pre-registrations.
              </label>
              <Button
                variant="outline"
                disabled={!archive() || !importPassphrase() || previewing()}
                onClick={() => void runPreview()}
              >
                {previewing() ? "Checking…" : "Preview archive"}
              </Button>
              <ErrorText error={previewError()} />

              <Show when={preview()}>
                {(value) => (
                  <div class="space-y-3">
                    <div class="rounded-lg border border-border bg-surface p-3">
                      <p class="text-xs font-medium text-foreground">
                        {value().source.name}
                        <span class="font-normal text-muted-foreground">
                          {" "}
                          ({value().source.slug})
                        </span>
                      </p>
                      <p class="mt-1 text-xs text-muted-foreground">
                        Exported {new Date(value().manifest.createdAt).toLocaleString()} from{" "}
                        {value().source.origin}
                      </p>
                      <p class="mt-1 text-xs text-muted-foreground">
                        {previewCounts()?.join(" · ")}
                      </p>
                      <Show when={value().crossDeployment}>
                        <p class="mt-2 text-xs text-warning-foreground">
                          Different deployment ({value().source.deploymentId.slice(0, 16)}…).
                        </p>
                      </Show>
                    </div>

                    <Show when={value().warnings.length > 0}>
                      <ul class="space-y-1.5">
                        <For each={value().warnings}>
                          {(warning) => (
                            <li class="flex items-start gap-2 text-xs text-muted-foreground">
                              <span class="mt-0.5 inline-flex shrink-0 text-warning">
                                <CircleAlert class="size-3.5" />
                              </span>
                              {warning}
                            </li>
                          )}
                        </For>
                      </ul>
                    </Show>

                    <Show when={value().conflicts.length > 0}>
                      <div class="space-y-1.5">
                        <p class="text-xs font-medium text-foreground">Conflicts</p>
                        <ul class="space-y-1.5">
                          <For each={value().conflicts}>
                            {(conflict) => (
                              <li class="rounded-lg border border-warning/25 bg-warning/[0.06] px-3 py-2 text-xs text-warning-foreground">
                                <span class="font-medium capitalize">
                                  {conflict.kind.replaceAll("_", " ")}:
                                </span>{" "}
                                {conflict.detail}
                              </li>
                            )}
                          </For>
                        </ul>
                      </div>
                    </Show>

                    <Show when={value().needsReissue.length > 0}>
                      <div class="space-y-1.5">
                        <p class="text-xs font-medium text-foreground">
                          Needs re-issuance after import
                        </p>
                        <ul class="max-h-40 space-y-1 overflow-y-auto text-xs text-muted-foreground">
                          <For each={value().needsReissue}>
                            {(item) => (
                              <li>
                                <span class="font-medium text-foreground">{item.item}</span> —{" "}
                                {item.reason}
                              </li>
                            )}
                          </For>
                        </ul>
                      </div>
                    </Show>

                    <div class="space-y-2 rounded-lg border border-border p-3">
                      <Show when={value().requirements.allowCrossDeployment}>
                        <label class="flex items-start gap-2 text-xs text-muted-foreground">
                          <Checkbox
                            class="mt-0.5"
                            checked={allowCrossDeployment()}
                            onCheckedChange={(checked) =>
                              setAllowCrossDeployment(checked === true)
                            }
                          />
                          I confirm this archive comes from a different deployment.
                        </label>
                      </Show>
                      <Show when={value().requirements.replaceConfiguration}>
                        <label class="flex items-start gap-2 text-xs text-muted-foreground">
                          <Checkbox
                            class="mt-0.5"
                            checked={replaceConfiguration()}
                            onCheckedChange={(checked) =>
                              setReplaceConfiguration(checked === true)
                            }
                          />
                          Replace this tenant's existing groups, policies and applications.
                        </label>
                      </Show>
                      <Show
                        when={value().conflicts.some((conflict) => conflict.kind === "scep_ca")}
                      >
                        <label class="flex items-start gap-2 text-xs text-muted-foreground">
                          <Checkbox
                            class="mt-0.5"
                            checked={replaceScepCa()}
                            onCheckedChange={(checked) => setReplaceScepCa(checked === true)}
                          />
                          Make the source SCEP CA the signing CA (the target CA stays trusted).
                        </label>
                      </Show>
                      <Show
                        when={value().conflicts.some((conflict) => conflict.kind === "escrow_key")}
                      >
                        <label class="flex items-start gap-2 text-xs text-muted-foreground">
                          <Checkbox
                            class="mt-0.5"
                            checked={replaceEscrowKey()}
                            onCheckedChange={(checked) => setReplaceEscrowKey(checked === true)}
                          />
                          Replace this tenant's FileVault escrow key with the archive's key.
                        </label>
                      </Show>
                      <Show
                        when={value().conflicts.some(
                          (conflict) => conflict.kind === "device_serial",
                        )}
                      >
                        <label class="flex items-center gap-2 text-xs text-muted-foreground">
                          <Checkbox
                            checked={deviceConflicts() === "skip"}
                            onCheckedChange={(checked) =>
                              setDeviceConflicts(checked === true ? "skip" : "fail")
                            }
                          />
                          Skip devices whose serial already exists in this tenant.
                        </label>
                      </Show>
                      <label class="block">
                        <span class="mb-1 block text-xs text-muted-foreground">
                          Type <span class="font-mono font-medium">{value().confirm}</span> to
                          confirm
                        </span>
                        <Input
                          value={confirm()}
                          onInput={(event) => setConfirm(event.currentTarget.value)}
                          placeholder={value().confirm}
                        />
                      </label>
                    </div>
                    <ErrorText error={importError()} />
                  </div>
                )}
              </Show>
            </div>
          </Show>

          <Show when={result()}>
            {(value) => (
              <div class="space-y-3">
                <div class="rounded-lg border border-success/25 bg-success/[0.07] p-3 text-sm">
                  <p class="font-medium text-success">
                    Imported {value().mode === "new" ? "as a new tenant" : "into this tenant"}
                  </p>
                  <p class="mt-1 text-xs text-muted-foreground">
                    {value().imported.devices} devices, {value().imported.deviceSecrets} escrowed
                    secrets, {value().imported.certificates} certificates,{" "}
                    {value().imported.members} members and {value().imported.auditEntries} audit
                    entries.
                  </p>
                  <p class="mt-1 text-xs text-muted-foreground">
                    Skipped: {value().skipped.devices} devices, {value().skipped.members} members,{" "}
                    {value().skipped.certificates} certificates, {value().skipped.auditEntries}{" "}
                    audit entries.
                  </p>
                </div>
                <Show when={value().needsReissue.length > 0}>
                  <div class="space-y-1">
                    <p class="text-xs font-medium text-foreground">Still to do</p>
                    <ul class="max-h-48 space-y-1 overflow-y-auto text-xs text-muted-foreground">
                      <For each={value().needsReissue}>
                        {(item) => (
                          <li>
                            <span class="font-medium text-foreground">{item.item}</span> —{" "}
                            {item.reason}
                          </li>
                        )}
                      </For>
                    </ul>
                  </div>
                </Show>
              </div>
            )}
          </Show>

          <input
            ref={(element) => {
              fileInput = element;
            }}
            type="file"
            accept="application/json,.json"
            class="hidden"
            aria-label="Cutover archive file"
            onChange={(event) => void chooseFile(event.currentTarget.files?.[0])}
          />

          <DialogFooter>
            <Show
              when={result()}
              fallback={
                <>
                  <Button variant="outline" onClick={() => setImportOpen(false)}>
                    Cancel
                  </Button>
                  <Button
                    disabled={
                      !preview() ||
                      importing() ||
                      confirm() !== preview()?.confirm ||
                      (preview()?.requirements.allowCrossDeployment === true &&
                        !allowCrossDeployment()) ||
                      (preview()?.requirements.replaceConfiguration === true &&
                        !replaceConfiguration())
                    }
                    onClick={() => void runImport()}
                  >
                    {importing() ? "Importing…" : "Import archive"}
                  </Button>
                </>
              }
            >
              <Button variant="outline" onClick={() => setImportOpen(false)}>
                Close
              </Button>
              <Show when={result()?.mode === "new"}>
                <Button onClick={() => navigate(`/t/${result()?.tenantId ?? tenantId()}/settings`)}>
                  Open imported tenant
                </Button>
              </Show>
            </Show>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Panel>
  );
}
