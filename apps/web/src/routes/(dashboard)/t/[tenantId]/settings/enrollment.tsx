import { useParams } from "@solidjs/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { createEffect, createSignal, For, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import { ErrorText, Field, Panel, QueryError } from "~/components/mdm/common";
import { QrCode } from "~/components/mdm/qr-code";
import { Button } from "~/components/ui/button";
import { CircleAlert, Info } from "~/components/ui/icons";
import { Input } from "~/components/ui/input";
import { enterprise, enterpriseKeys } from "~/lib/enterprise";
import { cn } from "~/lib/utils";

export default function EnrollmentSettingsPage() {
  const params = useParams();
  const qc = useQueryClient();

  const enrollment = useQuery(() => ({
    queryKey: enterpriseKeys.enrollment(params.tenantId),
    queryFn: () => enterprise.getTenantEnrollment(params.tenantId),
  }));

  const apns = useQuery(() => ({
    queryKey: enterpriseKeys.apns(params.tenantId),
    queryFn: () => enterprise.getApns(params.tenantId),
  }));

  const androidEnterprise = useQuery(() => ({
    queryKey: enterpriseKeys.android(params.tenantId),
    queryFn: () => enterprise.getTenantAndroid(params.tenantId),
  }));

  const attempts = useQuery(() => ({
    queryKey: enterpriseKeys.enrollmentAttempts(params.tenantId, 20),
    queryFn: () => enterprise.listEnrollmentAttempts(params.tenantId, 20),
  }));

  const preRegistrations = useQuery(() => ({
    queryKey: enterpriseKeys.devicePreRegistrations(params.tenantId),
    queryFn: () => enterprise.listDevicePreRegistrations(params.tenantId),
  }));

  const [edit, setEdit] = createSignal(false);
  const [code, setCode] = createSignal("");
  const [maxDevices, setMaxDevices] = createSignal(100);
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

  const url = () =>
    enrollment.data
      ? `${globalThis.location?.origin ?? ""}/enroll/${enrollment.data.id}`
      : "Loading…";

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: enterpriseKeys.enrollment(params.tenantId) });

  const save = useMutation(() => ({
    mutationFn: () =>
      enterprise.patchTenantEnrollment(params.tenantId, {
        code: code() || null,
        maxDevices: maxDevices(),
        enabledApple: apple(),
        enabledWindows: windows(),
        enabledAndroid: android(),
      }),
    onSuccess: async () => {
      setEdit(false);
      await invalidate();
    },
  }));

  const reset = useMutation(() => ({
    mutationFn: () => enterprise.resetTenantEnrollment(params.tenantId),
    onSuccess: invalidate,
  }));

  return (
    <div class="grid gap-5 xl:grid-cols-2">
      <QueryError
        class="xl:col-span-2"
        error={enrollment.error ?? apns.error ?? preRegistrations.error}
        onRetry={() => {
          void enrollment.refetch();
          void apns.refetch();
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

        <div class="mt-4 flex flex-col items-start gap-4 rounded-lg border border-white/[0.07] bg-white/[0.02] p-3 sm:flex-row sm:items-center">
          <Show when={enrollment.data}>
            <QrCode
              value={url()}
              label="QR code for the enrollment link"
              size={132}
              class="shrink-0 rounded-lg bg-white p-2"
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
        <fieldset disabled={!edit()} class="divide-y divide-white/[0.05] disabled:opacity-70">
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
            description="Android enrollment isn't available yet."
          />
        </fieldset>

        <p class="mt-4 flex items-start gap-2 rounded-lg border border-white/[0.07] bg-white/[0.02] p-3 text-xs leading-relaxed text-muted-foreground">
          <Info class="mt-px size-3.5 shrink-0" />
          <span>
            Asset tags are set from a device's detail page, or supplied ahead of time with a CSV
            pre-registration import on the Devices page.
          </span>
        </p>

        <div class="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Enrollment password" hint="Leave blank to allow open enrollment.">
            <Input
              type="password"
              value={code()}
              onInput={(e) => setCode(e.currentTarget.value)}
              placeholder="Optional password"
            />
          </Field>
          <Field label="Maximum devices" hint="Set to 0 for unlimited.">
            <Input
              type="number"
              min="0"
              value={String(maxDevices())}
              onInput={(e) => setMaxDevices(Number(e.currentTarget.value || 0))}
            />
          </Field>
        </div>

        <ErrorText error={save.error || reset.error} />

        <div class="mt-4 flex flex-wrap gap-2 border-t border-white/[0.06] pt-4">
          <Button
            onClick={() => (edit() ? save.mutate() : setEdit(true))}
            disabled={save.isPending}
          >
            {edit() ? (save.isPending ? "Saving…" : "Save") : "Edit settings"}
          </Button>
          <Button variant="destructive" onClick={() => reset.mutate()} disabled={reset.isPending}>
            {reset.isPending ? "Resetting…" : "Reset enrollment URL"}
          </Button>
        </div>
      </Panel>

      <Panel
        title="Platform readiness"
        description="What is ready for each family of devices before they can enrol."
      >
        <div class="divide-y divide-white/[0.05]">
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
        title="Pre-registered devices"
        description="Devices imported by serial before enrollment. Name, asset tag, notes and group are applied automatically when the device checks in."
        actions={
          <Button
            as="a"
            href={`/t/${params.tenantId}/devices?import=1`}
            variant="outline"
            size="sm"
          >
            Import CSV
          </Button>
        }
        flush
      >
        <Show
          when={(preRegistrations.data?.rows.length ?? 0) > 0}
          fallback={
            <p class="px-4 py-6 text-[13px] text-muted-foreground sm:px-5">
              {preRegistrations.isPending
                ? "Loading pre-registrations…"
                : "No devices are pre-registered yet."}
            </p>
          }
        >
          <ul class="divide-y divide-white/[0.05]">
            <For each={preRegistrations.data?.rows.slice(0, 5) ?? []}>
              {(row) => (
                <li class="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-[13px] sm:px-5">
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
            <p class="border-t border-white/[0.05] px-4 py-2.5 text-xs text-muted-foreground sm:px-5">
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
            <p class="px-4 py-6 text-[13px] text-muted-foreground sm:px-5">
              {attempts.isPending
                ? "Loading enrollment activity…"
                : "No enrollment attempts recorded yet."}
            </p>
          }
        >
          <ul class="divide-y divide-white/[0.05]">
            <For each={attempts.data?.attempts ?? []}>
              {(attempt) => (
                <li class="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-[13px] sm:px-5">
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
    </div>
  );
}

const outcomeTones = {
  ok: "success",
  bad_code: "warning",
  disabled: "neutral",
  limit: "warning",
  no_apns: "danger",
  scep_error: "danger",
  other: "neutral",
} as const;

const outcomeLabels: Record<string, string> = {
  ok: "Success",
  bad_code: "Bad password",
  disabled: "Disabled",
  limit: "Device limit",
  no_apns: "APNs missing",
  scep_error: "SCEP error",
  other: "Other",
};

const outcomeTone = (outcome: string) =>
  outcomeTones[outcome as keyof typeof outcomeTones] ?? outcomeTones.other;

const outcomeLabel = (outcome: string) => outcomeLabels[outcome] ?? outcome;

const platformLabel = (platform: string) =>
  platform === "apple"
    ? "Apple"
    : platform === "win"
      ? "Windows"
      : platform === "android"
        ? "Android"
        : "Unknown device";

const formatAttemptTime = (value: string) => {
  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
};

const chipTones = {
  neutral: "border-white/[0.08] bg-white/[0.03] text-muted-foreground",
  success: "border-success/25 bg-success/10 text-success-foreground",
  warning: "border-warning/25 bg-warning/10 text-warning-foreground",
  danger: "border-destructive/25 bg-destructive/10 text-destructive",
} as const;

function Chip(props: { tone: keyof typeof chipTones; children: JSX.Element; class?: string }) {
  return (
    <span
      class={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium",
        chipTones[props.tone],
        props.class,
      )}
    >
      <span class="size-1.5 rounded-full bg-current" aria-hidden="true" />
      {props.children}
    </span>
  );
}

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
      <span class="text-[13px] text-foreground">{props.label}</span>
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
          <span class="text-[13px] font-medium text-foreground">{props.title}</span>
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
      <span class="relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center">
        <input
          type="checkbox"
          class="peer absolute inset-0 z-10 size-full cursor-pointer opacity-0"
          checked={props.checked}
          onChange={(e) => props.onChange(e.currentTarget.checked)}
        />
        <span
          aria-hidden="true"
          class="h-5 w-9 rounded-full border border-white/[0.12] bg-white/[0.08] transition-colors duration-150 peer-checked:border-brand peer-checked:bg-brand peer-focus-visible:ring-2 peer-focus-visible:ring-ring/60 peer-disabled:opacity-50"
        />
        <span
          aria-hidden="true"
          class="pointer-events-none absolute left-0.5 top-0.5 size-3.5 rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,.4)] transition-transform duration-150 peer-checked:translate-x-[1.125rem] peer-disabled:opacity-50"
        />
      </span>
    </label>
  );
}
