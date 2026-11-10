import { useParams } from "@solidjs/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { createEffect, createSignal, Show } from "solid-js";
import { ErrorText, Field, QueryError } from "~/components/mdm/common";
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
    <div class="grid gap-6 xl:grid-cols-2">
      <QueryError
        class="xl:col-span-2"
        error={enrollment.error ?? apns.error}
        onRetry={() => {
          void enrollment.refetch();
          void apns.refetch();
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
          <Show when={!enabled()}>
            <p class="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              Enrollment is currently disabled. Enable at least one platform below.
            </p>
          </Show>
        </CardContent>
      </Card>

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
            <ToggleRow checked={android()} onChange={setAndroid} title="Android" />
            <ToggleRow
              checked={assetTag()}
              onChange={setAssetTag}
              title="Ask for an asset tag"
              description="Prompt for an asset tag during enrollment."
            />
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
    </div>
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
