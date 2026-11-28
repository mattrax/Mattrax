import { useParams } from "@solidjs/router";
import type { RoutePreloadFuncArgs } from "@solidjs/router";
import { Match } from "effect";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { createEffect, createSignal, For, Show } from "solid-js";
import type { EnrollmentQuestionRow } from "@mattrax/enterprise-domain/client";
import type { JSX } from "@solidjs/web";
import { ErrorText, Field, Panel, QueryError } from "~/components/mdm/common";
import QrCode from "~/components/mdm/qr-code";
import { Button } from "@mattrax/ui";
import { Checkbox, Switch } from "@mattrax/ui";
import ConfirmDialog from "~/components/ui/confirm-dialog";
import { CircleAlert, Info } from "~/components/ui/app-icons";
import { Input } from "@mattrax/ui";
import { PasswordInput } from "@mattrax/ui";
import { enterprise, enterpriseKeys, enterpriseQueries } from "~/lib/enterprise";
import type { TenantEnrollmentInfo } from "~/lib/enterprise";
import { optimisticallyUpdateCollection, optimisticUpdate } from "~/lib/optimistic";
import { preloadPage } from "~/lib/page-data";
import { queryClient } from "~/lib/query-client";
import { toast } from "~/components/toast";
import { ReadOnlyNotice, useCan } from "~/lib/permissions";
import { cn } from "~/lib/utils";
import Chip from "~/components/settings/status-chip";
import AppleByodPanel from "~/components/settings/apple-byod-panel";

export const route = {
  preload: ({ params, intent }: RoutePreloadFuncArgs) => {
    if (intent === "initial") return;

    // Above the fold: the enrollment link and platform readiness. The question
    // builder, pre-registrations and activity log load with the page.
    return preloadPage([
      () => queryClient.ensureQueryData(enterpriseQueries.enrollment(params.tenantId)),
      () => queryClient.ensureQueryData(enterpriseQueries.appleByod(params.tenantId)),
      () => queryClient.ensureQueryData(enterpriseQueries.apns(params.tenantId)),
      () => queryClient.ensureQueryData(enterpriseQueries.scepCa(params.tenantId)),
      () => queryClient.ensureQueryData(enterpriseQueries.android(params.tenantId)),
    ]);
  },
};

export default function EnrollmentSettingsPage() {
  const params = useParams();
  const qc = useQueryClient();
  const { can } = useCan();
  const writable = () => can("enrollment.write");

  const enrollment = useQuery(() => enterpriseQueries.enrollment(params.tenantId));

  const apns = useQuery(() => enterpriseQueries.apns(params.tenantId));

  const scepCa = useQuery(() => enterpriseQueries.scepCa(params.tenantId));

  const androidEnterprise = useQuery(() => enterpriseQueries.android(params.tenantId));

  const attempts = useQuery(() => enterpriseQueries.enrollmentAttempts(params.tenantId, 20));

  const preRegistrations = useQuery(() =>
    enterpriseQueries.devicePreRegistrations(params.tenantId),
  );

  const attributeDefinitions = useQuery(() => enterpriseQueries.attributes(params.tenantId));

  const enrollmentQuestions = useQuery(() =>
    enterpriseQueries.enrollmentQuestions(params.tenantId),
  );

  const [questionRows, setQuestionRows] = createSignal<
    Array<{ key: string; prompt: string; required: boolean | null }>
  >([]);

  createEffect(
    () => enrollmentQuestions.data,
    (data) => {
      if (!data) return;

      setQuestionRows(
        data.rows.map((row) => ({
          key: row.key,
          prompt: row.label,
          required: row.required,
        })),
      );
    },
  );

  const saveQuestions = useMutation(() => ({
    mutationFn: () =>
      enterprise.patchEnrollmentQuestions(params.tenantId, {
        questions: questionRows().map((row, index) => ({
          key: row.key,
          prompt: row.prompt || null,
          required: row.required,
          sortOrder: index,
        })),
      }),
    onMutate: async () => {
      const prompts = new Map(questionRows().map((row) => [row.key, row] as const));

      return optimisticallyUpdateCollection(
        qc,
        enterpriseKeys.enrollmentQuestions(params.tenantId),
        "rows",
        (rows: EnrollmentQuestionRow[]) =>
          rows.map((row): EnrollmentQuestionRow => {
            const question = prompts.get(row.key);

            if (!question) return row;

            // An empty prompt falls back to the attribute's own label, which is
            // what the API stores as `null`.
            return {
              ...row,
              label: question.prompt || row.label,
              // `null` means "inherit the attribute's requirement"; the resolved
              // boolean is unknown until the settled refetch.
              required: question.required ?? row.required,
            };
          }),
      );
    },
    onError: (_error, _variables, restore) => restore?.(),
    onSuccess: () => toast.success("Enrollment questions saved"),
    onSettled: () => {
      // The public enrollment page reads the same questions from `enrollment`.
      void qc.invalidateQueries({
        queryKey: enterpriseKeys.enrollmentQuestions(params.tenantId),
      });
      void qc.invalidateQueries({ queryKey: enterpriseKeys.enrollment(params.tenantId) });
    },
  }));

  const addableQuestions = () =>
    (attributeDefinitions.data?.rows ?? []).filter(
      (definition) => !questionRows().some((row) => row.key === definition.key),
    );

  const [edit, setEdit] = createSignal(false);
  const [code, setCode] = createSignal("");
  const [maxDevices, setMaxDevices] = createSignal(100);
  const [confirmReset, setConfirmReset] = createSignal(false);
  const [confirmRotateCa, setConfirmRotateCa] = createSignal(false);
  const [showCaImport, setShowCaImport] = createSignal(false);
  const [caCertificatePem, setCaCertificatePem] = createSignal("");
  const [caPrivateKeyPem, setCaPrivateKeyPem] = createSignal("");
  const [apple, setApple] = createSignal(false);
  const [windows, setWindows] = createSignal(false);
  const [android, setAndroid] = createSignal(false);

  createEffect(
    () => ({ data: enrollment.data, edit: edit() }),
    ({ data, edit }) => {
      if (!data || edit) return;
      setCode(data.code ?? "");
      setMaxDevices(data.maxDevices);
      setApple(data.enabledApple);
      setWindows(data.enabledWindows);
      setAndroid(data.enabledAndroid);
    },
  );

  const enabled = () => apple() || windows() || android();

  createEffect(
    () => writable(),
    (allowed) => {
      if (!allowed) setEdit(false);
    },
  );

  const url = () =>
    enrollment.data
      ? `${globalThis.location?.origin ?? ""}/enroll/${enrollment.data.id}`
      : "Loading…";

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: enterpriseKeys.enrollment(params.tenantId) });

  const save = useMutation(() => ({
    mutationFn: () => {
      if (maxDevices() < 0) throw new Error("Enter a maximum device count, or 0 for unlimited.");

      return enterprise.patchTenantEnrollment(params.tenantId, {
        code: code() || null,
        maxDevices: maxDevices(),
        enabledApple: apple(),
        enabledWindows: windows(),
        enabledAndroid: android(),
      });
    },
    onMutate: async () => {
      if (maxDevices() < 0) return;

      return optimisticUpdate<TenantEnrollmentInfo>(
        qc,
        enterpriseKeys.enrollment(params.tenantId),
        (current) => ({
          ...current,
          code: code() || null,
          maxDevices: maxDevices(),
          enabledApple: apple(),
          enabledWindows: windows(),
          enabledAndroid: android(),
        }),
      );
    },
    onSuccess: () => setEdit(false),
    onError: (_error, _variables, restore) => restore?.(),
    onSettled: () => void invalidate(),
  }));

  const reset = useMutation(() => ({
    mutationFn: () => enterprise.resetTenantEnrollment(params.tenantId),
    onSuccess: async () => {
      setConfirmReset(false);
      await invalidate();
    },
  }));

  const invalidateScep = () =>
    qc.invalidateQueries({ queryKey: enterpriseKeys.scepCa(params.tenantId) });

  const rotateCa = useMutation(() => ({
    mutationFn: () => enterprise.rotateTenantScepCa(params.tenantId),
    onSuccess: async () => {
      setConfirmRotateCa(false);
      await invalidateScep();
    },
  }));

  const importCa = useMutation(() => ({
    mutationFn: () =>
      enterprise.importTenantScepCa(params.tenantId, {
        certificatePem: caCertificatePem(),
        privateKeyPem: caPrivateKeyPem(),
      }),
    onSuccess: async () => {
      setShowCaImport(false);
      setCaCertificatePem("");
      setCaPrivateKeyPem("");
      await invalidateScep();
    },
  }));

  return (
    <div class="grid gap-5 xl:grid-cols-2">
      <QueryError
        class="xl:col-span-2"
        error={enrollment.error ?? apns.error ?? scepCa.error ?? preRegistrations.error}
        onRetry={() => {
          void enrollment.refetch();
          void apns.refetch();
          void scepCa.refetch();
          void preRegistrations.refetch();
        }}
      />

      <Panel
        class="xl:col-span-2"
        title="Enrollment link"
        description="Open this URL on a device to enroll it. If an enrollment password is set, share it separately."
      >
        <div class="flex flex-col gap-2 sm:flex-row">
          <Input
            readonly
            aria-label="Device enrollment URL"
            value={url()}
            onClick={(e) => e.currentTarget.select()}
            class="min-w-0 flex-1"
          />
          <div class="flex shrink-0 gap-2">
            <Button
              variant="outline"
              class="flex-1 sm:flex-none"
              onClick={() => navigator.clipboard.writeText(url())}
              disabled={!enrollment.data}
            >
              Copy
            </Button>
            <Button
              as="a"
              href={url()}
              target="_blank"
              variant="outline"
              class="flex-1 sm:flex-none"
            >
              Open
            </Button>
          </div>
        </div>

        <div class="mt-4 flex flex-col items-start gap-4 rounded-lg border border-border bg-surface p-3 sm:flex-row sm:items-center">
          <Show when={enrollment.data}>
            <QrCode
              value={url()}
              label="QR code for the enrollment link"
              size={132}
              class="shrink-0 rounded-lg bg-card p-2"
            />
          </Show>
          <p class="max-w-sm text-xs leading-relaxed text-muted-foreground">
            Scan this code with a phone or tablet to open the enrollment page. It contains the link
            only; share the enrollment password separately.
          </p>
        </div>

        <Show when={!enabled()}>
          <Callout tone="warning">
            Enrollment is currently disabled. Enable at least one platform below.
          </Callout>
        </Show>
        <Show when={android() && enrollment.data && !enrollment.data.androidAvailable}>
          <Callout tone="warning">
            Android enrollment is enabled but Android Enterprise is{" "}
            {androidEnterprise.data?.configured
              ? "not connected"
              : "not configured for this deployment"}
            . Open Settings → Management to finish setup. The public enrollment page explains this
            to devices.
          </Callout>
        </Show>
      </Panel>

      <Show when={windows() && enrollment.data?.windowsDiscoveryUrl}>
        <Panel
          class="xl:col-span-2"
          title="Windows enrollment URL"
          description='Use this URL in the Windows provisioning package or the "Access work or school" setup screen.'
        >
          <div class="flex flex-col gap-2 sm:flex-row">
            <Input
              readonly
              aria-label="Windows enrollment discovery URL"
              value={enrollment.data?.windowsDiscoveryUrl ?? ""}
              onClick={(e) => e.currentTarget.select()}
              class="min-w-0 flex-1"
            />
            <Button
              variant="outline"
              class="shrink-0"
              onClick={() =>
                navigator.clipboard.writeText(enrollment.data?.windowsDiscoveryUrl ?? "")
              }
            >
              Copy
            </Button>
          </div>
          <p class="mt-2 text-xs leading-relaxed text-muted-foreground">
            It identifies this tenant and expires; reopen this page for a fresh link.
            <Show when={enrollment.data?.windowsDiscoveryExpiresAt}>
              {(expiresAt) => <> This link expires {new Date(expiresAt()).toLocaleString()}.</>}
            </Show>
          </p>
        </Panel>
      </Show>

      <Panel title="Enrollment settings">
        <fieldset disabled={!edit()} class="divide-y divide-border disabled:opacity-70">
          <ToggleRow
            checked={enabled()}
            onChange={(value) => {
              setApple(value);
              setWindows(value);

              if (!value) setAndroid(false);
            }}
            title="Enable device enrollment"
            description="Disabling enrollment prevents new devices from enrolling."
          />
          <ToggleRow
            checked={apple()}
            onChange={setApple}
            title="Apple"
            badge={!apns.data?.configured ? "APNs setup required" : undefined}
          />
          <ToggleRow checked={windows()} onChange={setWindows} title="Windows" />
          <ToggleRow
            checked={android()}
            onChange={setAndroid}
            title="Android"
            description="Provision devices with a one-time Google enrollment token or QR code."
          />
        </fieldset>

        <Show when={apple() && apns.data && !apns.data.configured}>
          <p class="mt-4 flex items-start gap-2 rounded-lg border border-warning/25 bg-warning/[0.06] p-3 text-xs leading-relaxed text-warning-foreground">
            <Info class="mt-px size-3.5 shrink-0" />
            <span>
              Apple enrollment is on, but push notifications are not set up. Devices can enroll, yet
              commands and policy updates will not reach them until APNs is connected.{" "}
              <a
                class="font-medium underline underline-offset-2"
                href={`/t/${params.tenantId}/settings/management`}
              >
                Set up push notifications
              </a>
              .
            </span>
          </p>
        </Show>

        <p class="mt-4 flex items-start gap-2 rounded-lg border border-border bg-surface p-3 text-xs leading-relaxed text-muted-foreground">
          <Info class="mt-px size-3.5 shrink-0" />
          <span>
            Asset tags are set from a device's detail page, or supplied ahead of time with a CSV
            pre-registration import on the Devices page.
          </span>
        </p>

        <div class="mt-4 grid gap-4 sm:grid-cols-2">
          <Field
            label="Enrollment password"
            hint="At least 8 characters. Leave blank to allow open enrollment."
          >
            <PasswordInput
              value={code()}
              onInput={(e) => setCode(e.currentTarget.value)}
              placeholder="Optional password"
            />
          </Field>
          <Field label="Maximum devices" hint="Set to 0 for unlimited.">
            <Input
              type="number"
              min="0"
              value={maxDevices() < 0 ? "" : String(maxDevices())}
              onInput={(e) => {
                const raw = e.currentTarget.value;

                // Keep an empty field empty instead of collapsing it to the
                // very different "0 = unlimited" value.
                setMaxDevices(raw === "" ? -1 : Math.max(0, Math.floor(Number(raw) || 0)));
              }}
            />
          </Field>
        </div>

        <ErrorText error={save.error || reset.error} />

        <div class="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
          <Show
            when={writable()}
            fallback={
              <ReadOnlyNotice>
                Your role can view enrollment settings but not change them.
              </ReadOnlyNotice>
            }
          >
            <Button
              onClick={() => (edit() ? save.mutate() : setEdit(true))}
              disabled={save.isPending}
            >
              {edit() ? (save.isPending ? "Saving…" : "Save") : "Edit settings"}
            </Button>
            <Button
              variant="destructive"
              onClick={() => setConfirmReset(true)}
              disabled={reset.isPending}
            >
              Reset enrollment URL
            </Button>
          </Show>
        </div>
      </Panel>

      <AppleByodPanel tenantId={params.tenantId ?? ""} canWrite={writable()} />

      <Panel
        title="SCEP identity"
        description="Each tenant has its own CA. Devices receive their management identity from it, and the enrollment profile is signed with it."
      >
        <div class="divide-y divide-border">
          <ReadinessRow
            label="Tenant CA"
            value={scepCa.data?.configured ? "Created" : "Generated on first use"}
            active={!!scepCa.data?.configured}
          />
          <ReadinessRow
            label="Profile signature"
            value={scepCa.data?.configured ? "Signed" : "Signs on first download"}
            active={!!scepCa.data?.configured}
          />
        </div>

        <Show when={scepCa.data?.configured}>
          <dl class="mt-4 grid gap-3 rounded-lg border border-border bg-surface p-3 text-xs sm:grid-cols-2">
            <div class="min-w-0">
              <dt class="text-muted-foreground">CA certificate</dt>
              <dd class="mt-0.5 truncate font-medium text-foreground">
                {scepCa.data?.commonName ?? "Mattrax SCEP CA"}
              </dd>
            </div>
            <div class="min-w-0">
              <dt class="text-muted-foreground">Source</dt>
              <dd class="mt-0.5 font-medium capitalize text-foreground">
                {scepCa.data?.source ?? "generated"}
              </dd>
            </div>
            <div class="min-w-0 sm:col-span-2">
              <dt class="text-muted-foreground">SHA-256 fingerprint</dt>
              <dd class="mt-0.5 break-all font-mono text-xs text-foreground">
                {scepCa.data?.fingerprintSha256}
              </dd>
            </div>
            <div class="min-w-0">
              <dt class="text-muted-foreground">Expires</dt>
              <dd class="mt-0.5 text-foreground">
                {scepCa.data?.notAfter
                  ? new Date(scepCa.data.notAfter).toLocaleString()
                  : "Unknown"}
              </dd>
            </div>
            <div class="min-w-0">
              <dt class="text-muted-foreground">Last rotated</dt>
              <dd class="mt-0.5 text-foreground">
                {scepCa.data?.rotatedAt
                  ? new Date(scepCa.data.rotatedAt).toLocaleString()
                  : "Never"}
              </dd>
            </div>
            <div class="min-w-0">
              <dt class="text-muted-foreground">Rotation</dt>
              <dd class="mt-0.5 text-foreground">
                {scepCa.data?.rotationDue
                  ? "Due now"
                  : scepCa.data?.rotationDueAt
                    ? `Automatic from ${new Date(scepCa.data.rotationDueAt).toLocaleDateString()}`
                    : "Not scheduled"}
              </dd>
            </div>
            <div class="min-w-0">
              <dt class="text-muted-foreground">Predecessor CAs still trusted</dt>
              <dd class="mt-0.5 text-foreground">
                {scepCa.data?.retiring?.length ?? 0}
                {scepCa.data?.untrustedIdentities
                  ? ` · ${scepCa.data.untrustedIdentities} identities untrusted`
                  : ""}
              </dd>
            </div>
          </dl>
        </Show>

        <div class="mt-4 flex flex-col gap-2 sm:flex-row">
          <Input
            readonly
            aria-label="Tenant SCEP URL"
            value={scepCa.data?.scepUrl ?? ""}
            onClick={(e) => e.currentTarget.select()}
            class="min-w-0 flex-1"
          />
          <Button
            variant="outline"
            class="shrink-0"
            onClick={() => navigator.clipboard.writeText(scepCa.data?.scepUrl ?? "")}
            disabled={!scepCa.data?.scepUrl}
          >
            Copy
          </Button>
        </div>

        <Show when={showCaImport()}>
          <div class="mt-4 space-y-3 border-t border-border pt-4">
            <Field
              label="CA certificate"
              hint="PEM encoded. The CA must permit certificate signing."
            >
              <textarea
                class="min-h-24 w-full rounded-lg border border-input bg-surface p-3 font-mono text-base text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 sm:text-xs"
                aria-label="SCEP CA certificate PEM"
                placeholder="-----BEGIN CERTIFICATE-----"
                value={caCertificatePem()}
                onInput={(event) => setCaCertificatePem(event.currentTarget.value)}
              />
            </Field>
            <Field
              label="CA private key"
              hint="Unencrypted PKCS#8 PEM. It is sealed with the deployment secret before storage."
            >
              <textarea
                class="min-h-24 w-full rounded-lg border border-input bg-surface p-3 font-mono text-base text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 sm:text-xs"
                aria-label="SCEP CA private key PEM"
                placeholder="-----BEGIN PRIVATE KEY-----"
                value={caPrivateKeyPem()}
                onInput={(event) => setCaPrivateKeyPem(event.currentTarget.value)}
              />
            </Field>
            <p class="text-xs leading-relaxed text-muted-foreground">
              Importing a CA replaces the current one and revokes existing device identities.
              Devices must enroll again.
            </p>
          </div>
        </Show>

        <ErrorText error={rotateCa.error || importCa.error} />

        <div class="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
          <Show
            when={writable()}
            fallback={
              <ReadOnlyNotice>
                Your role can view the SCEP identity but not rotate or import it.
              </ReadOnlyNotice>
            }
          >
            <Show when={showCaImport()}>
              <Button onClick={() => importCa.mutate()} disabled={importCa.isPending}>
                {importCa.isPending ? "Importing…" : "Import CA"}
              </Button>
              <Button variant="ghost" onClick={() => setShowCaImport(false)}>
                Cancel
              </Button>
            </Show>
            <Show when={!showCaImport()}>
              <Button
                variant="outline"
                onClick={() => setShowCaImport(true)}
                disabled={importCa.isPending}
              >
                {scepCa.data?.configured ? "Use a custom CA" : "Upload a CA"}
              </Button>
              <Show when={scepCa.data?.configured}>
                <Button
                  variant="destructive"
                  onClick={() => setConfirmRotateCa(true)}
                  disabled={rotateCa.isPending}
                >
                  Rotate CA
                </Button>
              </Show>
            </Show>
          </Show>
        </div>
      </Panel>

      <Panel
        title="Platform readiness"
        description="What is ready for each family of devices before they can enrol."
      >
        <div class="divide-y divide-border">
          <ReadinessRow
            label="Apple push notifications"
            value={apns.data?.configured ? "Configured" : "Setup required"}
            active={!!apns.data?.configured}
          />
          <ReadinessRow
            label="Apple management"
            value={apple() ? "Enabled" : "Disabled"}
            active={apple()}
          />
          <ReadinessRow
            label="Windows management"
            value={windows() ? "Enabled" : "Disabled"}
            active={windows()}
          />
          <ReadinessRow
            label="Android management"
            value={android() ? "Enabled" : "Disabled"}
            active={android()}
          />
        </div>
        <Show when={!apns.data?.configured}>
          <p class="mt-3 flex items-start gap-2 rounded-lg border border-warning/20 bg-warning/[0.06] p-3 text-xs leading-relaxed text-warning-foreground">
            <CircleAlert class="mt-px size-3.5 shrink-0" />
            <span>
              Apple devices need an APNs certificate before they can be managed. Set it up from
              Management.
            </span>
          </p>
        </Show>
      </Panel>

      <Panel
        class="xl:col-span-2"
        title="Enrollment questions"
        description="Ask for device attributes while someone enrolls. Answers are validated and written to the device when it first checks in."
        actions={
          <Show when={writable() && questionRows().length > 0}>
            <Button
              size="sm"
              disabled={saveQuestions.isPending}
              onClick={() => saveQuestions.mutate()}
            >
              {saveQuestions.isPending ? "Saving…" : "Save questions"}
            </Button>
          </Show>
        }
        flush
      >
        <div class="space-y-3 px-4 py-4 sm:px-5">
          <Show
            when={questionRows().length > 0}
            fallback={
              <p class="text-xs text-muted-foreground">
                {attributeDefinitions.isPending
                  ? "Loading attributes…"
                  : "No custom questions. Add a registered attribute to ask for it during enrollment."}
              </p>
            }
          >
            <ul class="divide-y divide-border rounded-lg border border-border">
              <For each={questionRows()}>
                {(row, index) => (
                  <li class="grid gap-2 px-3 py-2.5 sm:grid-cols-3 sm:items-center">
                    <div class="min-w-0">
                      <p class="font-mono text-xs text-muted-foreground">{row.key}</p>
                      <Input
                        class="mt-1 h-8"
                        disabled={!writable()}
                        value={row.prompt}
                        placeholder="Question shown at enrollment"
                        onInput={(event) =>
                          setQuestionRows(
                            questionRows().map((candidate, position) =>
                              position === index()
                                ? { ...candidate, prompt: event.currentTarget.value }
                                : candidate,
                            ),
                          )
                        }
                      />
                    </div>
                    <label class="flex items-center gap-2 text-xs">
                      <Checkbox
                        disabled={!writable()}
                        checked={row.required === true}
                        onCheckedChange={(checked) =>
                          setQuestionRows(
                            questionRows().map((candidate, position) =>
                              position === index()
                                ? { ...candidate, required: checked === true }
                                : candidate,
                            ),
                          )
                        }
                      />
                      Required
                    </label>
                    <Show when={writable()}>
                      <Button
                        variant="ghost"
                        size="xs"
                        class="justify-self-start sm:justify-self-end"
                        onClick={() =>
                          setQuestionRows(
                            questionRows().filter((_, position) => position !== index()),
                          )
                        }
                      >
                        <span class="text-destructive">Remove</span>
                      </Button>
                    </Show>
                  </li>
                )}
              </For>
            </ul>
          </Show>

          <Show when={writable() && addableQuestions().length > 0}>
            <div class="flex flex-wrap items-center gap-2">
              <select
                class="h-8 min-w-48 rounded-lg border border-input bg-transparent px-2 text-xs text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 dark:bg-input/30"
                aria-label="Add an enrollment question"
                value=""
                onChange={(event) => {
                  const key = event.currentTarget.value;

                  if (!key) return;

                  const definition = (attributeDefinitions.data?.rows ?? []).find(
                    (candidate) => candidate.key === key,
                  );

                  if (!definition) return;
                  setQuestionRows([
                    ...questionRows(),
                    {
                      key,
                      prompt: definition.label,
                      required: definition.required,
                    },
                  ]);
                  event.currentTarget.value = "";
                }}
              >
                <option value="">Add attribute…</option>
                <For each={addableQuestions()}>
                  {(definition) => (
                    <option value={definition.key}>
                      {definition.label} ({definition.key})
                    </option>
                  )}
                </For>
              </select>
              <Button
                as="a"
                variant="outline"
                size="sm"
                href={`/t/${params.tenantId}/settings/attributes`}
              >
                Manage attributes
              </Button>
            </div>
          </Show>
          <ErrorText error={saveQuestions.error} />
        </div>
      </Panel>

      <Panel
        class="xl:col-span-2"
        title="Pre-registered devices"
        description="Devices imported by serial before enrollment. Name, asset tag, notes and group are applied automatically when the device checks in."
        actions={
          <Show when={can("devices.write")}>
            <Button
              as="a"
              href={`/t/${params.tenantId}/devices?import=1`}
              variant="outline"
              size="sm"
            >
              Import CSV
            </Button>
          </Show>
        }
        flush
      >
        <Show
          when={(preRegistrations.data?.rows.length ?? 0) > 0}
          fallback={
            <p class="px-4 py-6 text-xs text-muted-foreground sm:px-5">
              {preRegistrations.isPending
                ? "Loading pre-registrations…"
                : "No devices are pre-registered yet."}
            </p>
          }
        >
          <ul class="divide-y divide-border">
            <For each={preRegistrations.data?.rows.slice(0, 5) ?? []}>
              {(row) => (
                <li class="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-xs sm:px-5">
                  <span class="font-medium text-foreground">{row.serial}</span>
                  <span class="text-muted-foreground">{row.name ?? "Unnamed"}</span>
                  <Show when={row.assetTag}>
                    <span class="text-xs text-muted-foreground">Asset: {row.assetTag}</span>
                  </Show>
                  <Show when={row.groupName}>
                    <span class="text-xs text-muted-foreground">Group: {row.groupName}</span>
                  </Show>
                  <Chip
                    tone={row.consumedDeviceId ? "success" : "neutral"}
                    class="ml-auto shrink-0"
                  >
                    {row.consumedDeviceId ? "Applied" : "Pending"}
                  </Chip>
                </li>
              )}
            </For>
          </ul>
          <Show when={(preRegistrations.data?.rows.length ?? 0) > 5}>
            <p class="border-t border-border px-4 py-2.5 text-xs text-muted-foreground sm:px-5">
              Showing 5 of {preRegistrations.data?.rows.length} pre-registrations. Import more or
              manage devices from the Devices page.
            </p>
          </Show>
        </Show>
      </Panel>

      <Panel
        class="xl:col-span-2"
        title="Enrollment activity"
        description="Recent visits to this tenant's enrollment link. Retained for 30 days."
        actions={
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void attempts.refetch()}
            disabled={attempts.isFetching}
          >
            Refresh
          </Button>
        }
        flush
      >
        <Show
          when={(attempts.data?.attempts.length ?? 0) > 0}
          fallback={
            <p class="px-4 py-6 text-xs text-muted-foreground sm:px-5">
              {attempts.isPending
                ? "Loading enrollment activity…"
                : "No enrollment attempts recorded yet."}
            </p>
          }
        >
          <ul class="divide-y divide-border">
            <For each={attempts.data?.attempts ?? []}>
              {(attempt) => (
                <li class="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-xs sm:px-5">
                  <Chip tone={outcomeTone(attempt.outcome)} class="shrink-0">
                    {outcomeLabel(attempt.outcome)}
                  </Chip>
                  <span class="font-medium text-foreground">{platformLabel(attempt.platform)}</span>
                  <span class="min-w-0 break-words text-muted-foreground">
                    {attempt.detail ?? "—"}
                  </span>
                  <span class="ml-auto whitespace-nowrap text-xs text-muted-foreground">
                    {formatAttemptTime(attempt.createdAt)}
                  </span>
                </li>
              )}
            </For>
          </ul>
        </Show>
        <div class="px-4 pb-4 sm:px-5">
          <ErrorText error={attempts.error} />
        </div>
      </Panel>

      <ConfirmDialog
        open={confirmRotateCa()}
        onOpenChange={setConfirmRotateCa}
        title="Rotate the tenant SCEP CA?"
        description="A new CA starts signing new and renewed identities. The previous CA stays a trust anchor until it expires, so enrolled devices keep checking in and renew without enrolling again. Other tenants are not affected."
        confirmLabel="Rotate CA"
        pending={rotateCa.isPending}
        onConfirm={() => rotateCa.mutate()}
      />

      <ConfirmDialog
        open={confirmReset()}
        onOpenChange={setConfirmReset}
        title="Reset the enrollment URL?"
        description="Every existing enrollment link, QR code and pre-registration code stops working immediately. Devices already enrolled stay enrolled."
        confirmLabel="Reset enrollment URL"
        destructive
        pending={reset.isPending}
        onConfirm={() => reset.mutate()}
      />
    </div>
  );
}

const outcomeLabels = new Map<string, string>([
  ["ok", "Success"],
  ["bad_code", "Bad password"],
  ["disabled", "Disabled"],
  ["limit", "Device limit"],
  ["no_apns", "APNs missing"],
  ["scep_error", "SCEP error"],
  ["other", "Other"],
]);

const outcomeTone = (outcome: string) =>
  Match.value(outcome).pipe(
    Match.when("ok", () => "success" as const),
    Match.when("bad_code", () => "warning" as const),
    Match.when("disabled", () => "neutral" as const),
    Match.when("limit", () => "warning" as const),
    Match.when("no_apns", () => "danger" as const),
    Match.when("scep_error", () => "danger" as const),
    Match.orElse(() => "neutral" as const),
  );

const outcomeLabel = (outcome: string) => outcomeLabels.get(outcome) ?? outcome;

const platformLabel = (platform: string) =>
  Match.value(platform).pipe(
    Match.when("apple", () => "Apple"),
    Match.when("win", () => "Windows"),
    Match.when("android", () => "Android"),
    Match.orElse(() => "Unknown device"),
  );

const formatAttemptTime = (value: string) => {
  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
};



function Callout(props: { tone: "warning" | "danger"; children: JSX.Element }) {
  return (
    <p
      role="status"
      class={cn(
        "mt-4 flex items-start gap-2 rounded-lg border p-3 text-xs leading-relaxed",
        props.tone === "danger"
          ? "border-destructive/25 bg-destructive/[0.07] text-destructive"
          : "border-warning/25 bg-warning/[0.07] text-warning-foreground",
      )}
    >
      <CircleAlert class="mt-px size-3.5 shrink-0" />
      <span>{props.children}</span>
    </p>
  );
}

function ReadinessRow(props: { label: string; value: string; active: boolean }) {
  return (
    <div class="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
      <span class="text-xs text-foreground">{props.label}</span>
      <Chip tone={props.active ? "success" : "neutral"}>{props.value}</Chip>
    </div>
  );
}

function ToggleRow(props: {
  checked: boolean;
  onChange: (value: boolean) => void;
  title: string;
  description?: string;
  badge?: string;
}) {
  return (
    <label class="flex cursor-pointer items-start justify-between gap-4 py-3.5 first:pt-0 last:pb-0">
      <span class="min-w-0">
        <span class="flex flex-wrap items-center gap-2">
          <span class="text-xs font-medium text-foreground">{props.title}</span>
          <Show when={props.badge}>
            <Chip tone="warning">{props.badge}</Chip>
          </Show>
        </span>
        <Show when={props.description}>
          <span class="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
            {props.description}
          </span>
        </Show>
      </span>
      <Switch
        class="mt-0.5"
        checked={props.checked}
        onCheckedChange={(checked) => props.onChange(checked === true)}
        aria-label={props.title}
      />
    </label>
  );
}
