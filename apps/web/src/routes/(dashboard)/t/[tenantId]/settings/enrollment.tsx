import { useParams } from "@solidjs/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { createEffect, createSignal, For, Show } from "solid-js";
import { ErrorText, Field, QueryError } from "~/components/mdm/common";
import { QrCode } from "~/components/mdm/qr-code";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { enterprise, enterpriseKeys } from "~/lib/enterprise";

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
    <div class="grid gap-6 xl:grid-cols-2">
      <QueryError
        class="xl:col-span-2"
        error={enrollment.error ?? apns.error ?? preRegistrations.error}
        onRetry={() => {
          void enrollment.refetch();
          void apns.refetch();
          void preRegistrations.refetch();
        }}
      />
      <Card class="xl:col-span-2">
        <CardHeader>
          <CardTitle>Enrollment link</CardTitle>
        </CardHeader>
        <CardContent class="space-y-4">
          <p class="text-sm text-muted-foreground">
            Open this URL on a device to enroll it. If an enrollment password is set, share it
            separately.
          </p>
          <div class="flex gap-2">
            <Input readonly value={url()} onClick={(e) => e.currentTarget.select()} />
            <Button
              variant="outline"
              onClick={() => navigator.clipboard.writeText(url())}
              disabled={!enrollment.data}
            >
              Copy
            </Button>
            <Button as="a" href={url()} target="_blank" variant="outline">
              Open
            </Button>
          </div>
          <div class="flex flex-wrap items-center gap-4 rounded-lg border bg-stone-50 p-3">
            <Show when={enrollment.data}>
              <QrCode value={url()} label="QR code for the enrollment link" size={132} />
            </Show>
            <p class="max-w-sm text-sm text-muted-foreground">
              Scan this code with a phone or tablet to open the enrollment page. It contains the
              link only; share the enrollment password separately.
            </p>
          </div>
          <Show when={!enabled()}>
            <p class="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              Enrollment is currently disabled. Enable at least one platform below.
            </p>
          </Show>
        </CardContent>
      </Card>

      <Show when={windows() && enrollment.data?.windowsDiscoveryUrl}>
        <Card>
          <CardHeader>
            <CardTitle>Windows enrollment URL</CardTitle>
          </CardHeader>
          <CardContent class="space-y-3">
            <p class="text-sm text-muted-foreground">
              Use this URL in the Windows provisioning package or the "Access work or school" setup
              screen. It identifies this tenant and expires; reopen this page for a fresh link.
            </p>
            <div class="flex gap-2">
              <Input
                readonly
                value={enrollment.data?.windowsDiscoveryUrl ?? ""}
                onClick={(e) => e.currentTarget.select()}
              />
              <Button
                variant="outline"
                onClick={() =>
                  navigator.clipboard.writeText(enrollment.data?.windowsDiscoveryUrl ?? "")
                }
              >
                Copy
              </Button>
            </div>
            <Show when={enrollment.data?.windowsDiscoveryExpiresAt}>
              {(expiresAt) => (
                <p class="text-xs text-muted-foreground">
                  This link expires {new Date(expiresAt()).toLocaleString()}.
                </p>
              )}
            </Show>
          </CardContent>
        </Card>
      </Show>

      <Card>
        <CardHeader>
          <CardTitle>Enrollment settings</CardTitle>
        </CardHeader>
        <CardContent class="space-y-5">
          <fieldset disabled={!edit()} class="space-y-5 disabled:opacity-70">
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
            <p class="rounded-lg border border-stone-200 bg-stone-50 p-3 text-sm text-stone-600">
              Asset tags are set from a device's detail page, or supplied ahead of time with a CSV
              pre-registration import on the Devices page.
            </p>
            <div class="grid gap-4 md:grid-cols-2">
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
          </fieldset>
          <ErrorText error={save.error || reset.error} />
          <div class="flex flex-wrap gap-2">
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Platform readiness</CardTitle>
        </CardHeader>
        <CardContent class="space-y-3 text-sm">
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
          <Show when={!apns.data?.configured}>
            <p class="pt-2 text-xs text-muted-foreground">
              Apple devices need an APNs certificate before they can be managed. Set it up from
              Management.
            </p>
          </Show>
        </CardContent>
      </Card>

      <Card class="xl:col-span-2">
        <CardHeader>
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle>Pre-registered devices</CardTitle>
              <p class="mt-1 text-sm text-muted-foreground">
                Devices imported by serial before enrollment. Name, asset tag, notes and group are
                applied automatically when the device checks in.
              </p>
            </div>
            <Button
              as="a"
              href={`/t/${params.tenantId}/devices?import=1`}
              variant="outline"
              size="sm"
            >
              Import CSV
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <Show
            when={(preRegistrations.data?.rows.length ?? 0) > 0}
            fallback={
              <p class="text-sm text-muted-foreground">
                {preRegistrations.isPending
                  ? "Loading pre-registrations…"
                  : "No devices are pre-registered yet."}
              </p>
            }
          >
            <ul class="divide-y rounded-lg border">
              <For each={preRegistrations.data?.rows.slice(0, 5) ?? []}>
                {(row) => (
                  <li class="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                    <span class="font-medium text-stone-800">{row.serial}</span>
                    <span class="text-muted-foreground">{row.name ?? "Unnamed"}</span>
                    <Show when={row.assetTag}>
                      <span class="text-xs text-muted-foreground">Asset: {row.assetTag}</span>
                    </Show>
                    <Show when={row.groupName}>
                      <span class="text-xs text-muted-foreground">Group: {row.groupName}</span>
                    </Show>
                    <Badge variant={row.consumedDeviceId ? "secondary" : "default"} class="ml-auto">
                      {row.consumedDeviceId ? "Applied" : "Pending"}
                    </Badge>
                  </li>
                )}
              </For>
            </ul>
            <Show when={(preRegistrations.data?.rows.length ?? 0) > 5}>
              <p class="mt-2 text-xs text-muted-foreground">
                Showing 5 of {preRegistrations.data?.rows.length} pre-registrations. Import more or
                manage devices from the Devices page.
              </p>
            </Show>
          </Show>
        </CardContent>
      </Card>

      <Card class="xl:col-span-2">
        <CardHeader>
          <div class="flex items-center justify-between gap-2">
            <div>
              <CardTitle>Enrollment activity</CardTitle>
              <p class="mt-1 text-sm text-muted-foreground">
                Recent visits to this tenant's enrollment link. Retained for 30 days.
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void attempts.refetch()}
              disabled={attempts.isFetching}
            >
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <Show
            when={(attempts.data?.attempts.length ?? 0) > 0}
            fallback={
              <p class="text-sm text-muted-foreground">
                {attempts.isPending
                  ? "Loading enrollment activity…"
                  : "No enrollment attempts recorded yet."}
              </p>
            }
          >
            <ul class="divide-y rounded-lg border">
              <For each={attempts.data?.attempts ?? []}>
                {(attempt) => (
                  <li class="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                    <span
                      class={`rounded-full border px-2 py-0.5 text-xs font-medium ${outcomeClass(attempt.outcome)}`}
                    >
                      {outcomeLabel(attempt.outcome)}
                    </span>
                    <span class="font-medium text-stone-800">
                      {platformLabel(attempt.platform)}
                    </span>
                    <span class="text-muted-foreground">{attempt.detail ?? "—"}</span>
                    <span class="ml-auto whitespace-nowrap text-xs text-muted-foreground">
                      {formatAttemptTime(attempt.createdAt)}
                    </span>
                  </li>
                )}
              </For>
            </ul>
          </Show>
          <ErrorText error={attempts.error} />
        </CardContent>
      </Card>
    </div>
  );
}

const outcomeStyles: Record<string, string> = {
  ok: "border-green-200 bg-green-50 text-green-700",
  bad_code: "border-amber-200 bg-amber-50 text-amber-800",
  disabled: "border-stone-200 bg-stone-50 text-stone-600",
  limit: "border-amber-200 bg-amber-50 text-amber-800",
  no_apns: "border-red-200 bg-red-50 text-red-700",
  scep_error: "border-red-200 bg-red-50 text-red-700",
  other: "border-stone-200 bg-stone-50 text-stone-600",
};

const outcomeLabels: Record<string, string> = {
  ok: "Success",
  bad_code: "Bad password",
  disabled: "Disabled",
  limit: "Device limit",
  no_apns: "APNs missing",
  scep_error: "SCEP error",
  other: "Other",
};

const outcomeClass = (outcome: string) => outcomeStyles[outcome] ?? outcomeStyles.other;
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

function ReadinessRow(props: { label: string; value: string; active: boolean }) {
  return (
    <div class="flex items-center justify-between">
      <span>{props.label}</span>
      <Badge variant={props.active ? "default" : "secondary"}>{props.value}</Badge>
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
    <label class="flex gap-3">
      <input
        type="checkbox"
        class="mt-0.5"
        checked={props.checked}
        onChange={(e) => props.onChange(e.currentTarget.checked)}
      />
      <span>
        <strong class="text-sm">{props.title}</strong>
        <Show when={props.badge}>
          <Badge variant="secondary" class="ml-2">
            {props.badge}
          </Badge>
        </Show>
        <Show when={props.description}>
          <span class="block text-sm text-muted-foreground">{props.description}</span>
        </Show>
      </span>
    </label>
  );
}
