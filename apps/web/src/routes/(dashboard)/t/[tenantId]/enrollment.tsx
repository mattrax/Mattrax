import { useParams } from "@solidjs/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { createEffect, createSignal, Show } from "solid-js";
import { ErrorText, Field, PageHeader } from "~/components/mdm/common";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { enterprise, enterpriseKeys } from "~/lib/enterprise";

export default function EnrollmentPage() {
  const params = useParams();
  const queryClient = useQueryClient();
  const enrollment = useQuery(() => ({
    queryKey: enterpriseKeys.enrollment(params.tenantId),
    queryFn: () => enterprise.getTenantEnrollment(params.tenantId),
  }));
  const apns = useQuery(() => ({
    queryKey: enterpriseKeys.apns(params.tenantId),
    queryFn: () => enterprise.getApns(params.tenantId),
  }));

  const [edit, setEdit] = createSignal(false);
  const [code, setCode] = createSignal("");
  const [maxDevices, setMaxDevices] = createSignal(100);
  const [apple, setApple] = createSignal(false);
  const [windows, setWindows] = createSignal(false);
  const [android, setAndroid] = createSignal(false);
  const [assetTag, setAssetTag] = createSignal(false);

  createEffect(
    () => ({ data: enrollment.data, edit: edit() }),
    ({ data, edit }) => {
      if (!data || edit) return;
      setCode(data.code ?? "");
      setMaxDevices(data.maxDevices);
      setApple(data.enabledApple);
      setWindows(data.enabledWindows);
      setAndroid(data.enabledAndroid);
      setAssetTag(data.enabledAssetTag);
    },
  );

  const enabled = () => apple() || windows() || android();
  const enrollmentUrl = () =>
    enrollment.data
      ? `${globalThis.location?.origin ?? ""}/enroll/${enrollment.data.id}`
      : "Loading...";
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: enterpriseKeys.enrollment(params.tenantId) });
  const save = useMutation(() => ({
    mutationFn: () =>
      enterprise.patchTenantEnrollment(params.tenantId, {
        code: code() || null,
        maxDevices: maxDevices(),
        enabledApple: apple(),
        enabledWindows: windows(),
        enabledAndroid: android(),
        enabledAssetTag: assetTag(),
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
    <div class="flex flex-1 flex-col gap-6 p-6">
      <PageHeader
        title="Enrollment"
        description="Configure tenant enrollment and share the enrollment URL."
        actions={
          <HeaderActions
            edit={edit()}
            saving={save.isPending}
            resetting={reset.isPending}
            onEdit={() => (edit() ? save.mutate() : setEdit(true))}
            onReset={() => reset.mutate()}
          />
        }
      />
      <div class="grid gap-6 lg:grid-cols-2">
        <EnrollmentUrlCard url={enrollmentUrl()} enabled={enabled()} />
        <ReadinessCard
          apnsConfigured={!!apns.data?.configured}
          windows={windows()}
          android={android()}
        />
        <SettingsCard
          edit={edit()}
          enabled={enabled()}
          apple={apple()}
          windows={windows()}
          android={android()}
          assetTag={assetTag()}
          code={code()}
          maxDevices={maxDevices()}
          apnsConfigured={!!apns.data?.configured}
          error={save.error || reset.error}
          setEnabled={(value) => {
            setApple(value);
            setWindows(value);
            if (!value) setAndroid(false);
          }}
          setApple={setApple}
          setWindows={setWindows}
          setAndroid={setAndroid}
          setAssetTag={setAssetTag}
          setCode={setCode}
          setMaxDevices={setMaxDevices}
        />
      </div>
    </div>
  );
}

function HeaderActions(props: {
  edit: boolean;
  saving: boolean;
  resetting: boolean;
  onEdit: () => void;
  onReset: () => void;
}) {
  return (
    <>
      <Button variant="outline" onClick={props.onEdit} disabled={props.saving}>
        {props.edit ? "Save" : "Edit"}
      </Button>
      <Button variant="destructive" onClick={props.onReset} disabled={props.resetting}>
        Reset URL
      </Button>
    </>
  );
}

function EnrollmentUrlCard(props: { url: string; enabled: boolean }) {
  const copy = (event: MouseEvent & { currentTarget: HTMLInputElement }) => {
    event.currentTarget.select();
    void navigator.clipboard.writeText(props.url);
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>Enrollment URL</CardTitle>
      </CardHeader>
      <CardContent class="space-y-4">
        <p class="text-sm text-muted-foreground">
          Open this URL on a device to enroll it. Share the password separately if configured.
        </p>
        <div class="flex gap-2">
          <Input readonly value={props.url} onClick={copy} />
          <Button as="a" href={props.url} target="_blank" variant="outline">
            Open
          </Button>
        </div>
        <Show when={!props.enabled}>
          <p class="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            Enrollment is currently disabled.
          </p>
        </Show>
      </CardContent>
    </Card>
  );
}

function ReadinessCard(props: { apnsConfigured: boolean; windows: boolean; android: boolean }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Platform readiness</CardTitle>
      </CardHeader>
      <CardContent class="space-y-3 text-sm">
        <ReadinessRow
          label="Apple APNS"
          value={props.apnsConfigured ? "Configured" : "Setup required"}
          active={props.apnsConfigured}
        />
        <ReadinessRow
          label="Windows"
          value={props.windows ? "Enabled" : "Disabled"}
          active={props.windows}
        />
        <ReadinessRow
          label="Android"
          value={props.android ? "Enabled" : "Disabled"}
          active={props.android}
        />
      </CardContent>
    </Card>
  );
}

function ReadinessRow(props: { label: string; value: string; active: boolean }) {
  return (
    <div class="flex items-center justify-between">
      <span>{props.label}</span>
      <Badge variant={props.active ? "default" : "secondary"}>{props.value}</Badge>
    </div>
  );
}

function SettingsCard(props: {
  edit: boolean;
  enabled: boolean;
  apple: boolean;
  windows: boolean;
  android: boolean;
  assetTag: boolean;
  code: string;
  maxDevices: number;
  apnsConfigured: boolean;
  error: unknown;
  setEnabled: (value: boolean) => void;
  setApple: (value: boolean) => void;
  setWindows: (value: boolean) => void;
  setAndroid: (value: boolean) => void;
  setAssetTag: (value: boolean) => void;
  setCode: (value: string) => void;
  setMaxDevices: (value: number) => void;
}) {
  return (
    <Card class="lg:col-span-2">
      <CardHeader>
        <CardTitle>Settings</CardTitle>
      </CardHeader>
      <CardContent>
        <fieldset disabled={!props.edit} class="grid gap-5 disabled:opacity-70">
          <ToggleRow
            checked={props.enabled}
            onChange={props.setEnabled}
            title="Enable device enrollment"
            description="Disabling enrollment prevents new devices from enrolling."
          />
          <ToggleRow
            checked={props.apple}
            onChange={props.setApple}
            title="Enable Apple management"
            badge={!props.apnsConfigured ? "APNS setup required" : undefined}
          />
          <ToggleRow
            checked={props.windows}
            onChange={props.setWindows}
            title="Enable Windows management"
          />
          <ToggleRow
            checked={props.android}
            onChange={props.setAndroid}
            title="Enable Android management"
          />
          <ToggleRow
            checked={props.assetTag}
            onChange={props.setAssetTag}
            title="Ask for asset tag during enrollment"
          />
          <div class="grid gap-4 md:grid-cols-2">
            <Field label="Enrollment password">
              <Input
                type="password"
                value={props.code}
                onInput={(event) => props.setCode(event.currentTarget.value)}
                placeholder="Optional password"
              />
            </Field>
            <Field label="Maximum devices">
              <Input
                type="number"
                min="0"
                value={String(props.maxDevices)}
                onInput={(event) => props.setMaxDevices(Number(event.currentTarget.value || 0))}
              />
            </Field>
          </div>
        </fieldset>
        <ErrorText error={props.error} />
      </CardContent>
    </Card>
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
        checked={props.checked}
        onChange={(event) => props.onChange(event.currentTarget.checked)}
      />
      <span>
        <strong>{props.title}</strong>
        <Show when={props.badge}>
          <Badge variant="secondary" class="ml-2">
            {props.badge}
          </Badge>
        </Show>
        <Show when={props.description}>
          <br />
          <span class="text-sm text-muted-foreground">{props.description}</span>
        </Show>
      </span>
    </label>
  );
}
