import { useParams } from "@solidjs/router";
import type { RoutePreloadFuncArgs } from "@solidjs/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { createEffect, createSignal, For, Show } from "solid-js";
import type { OsPolicyPlatform, TenantOsPolicyPlatform } from "@mattrax/enterprise-domain/client";
import { Badge, NativeSelect } from "@mattrax/ui";
import { ErrorText, Field, Panel, QueryError } from "~/components/mdm/common";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { enterprise, enterpriseKeys, enterpriseQueries } from "~/lib/enterprise";
import { preloadPage } from "~/lib/page-data";
import { queryClient } from "~/lib/query-client";
import { ReadOnlyNotice, useCan } from "~/lib/permissions";
import { toast } from "~/components/toast";

export const route = {
  preload: ({ params, intent }: RoutePreloadFuncArgs) => {
    if (intent === "initial") return;

    return preloadPage([
      () => queryClient.ensureQueryData(enterpriseQueries.osPolicy(params.tenantId)),
    ]);
  },
};

type Draft = {
  minimumVersion: string;
  enforcement: "off" | "warn" | "enforce";
  deferralDays: string;
};

const draftFrom = (platform: TenantOsPolicyPlatform): Draft => ({
  minimumVersion: platform.minimumVersion ?? "",
  enforcement: platform.enforcement,
  deferralDays: String(platform.deferralDays),
});

const platformLabel = (platform: OsPolicyPlatform) => {
  switch (platform) {
    case "macos":
      return "macOS";
    case "ios":
      return "iOS";
    case "ipados":
      return "iPadOS";
    case "windows":
      return "Windows";
    case "android":
      return "Android";
  }
};

const versionExample = (platform: OsPolicyPlatform) => {
  switch (platform) {
    case "windows":
      return "10.0.22631";
    case "android":
      return "14";
    case "ios":
    case "ipados":
      return "18.1";
    default:
      return "14.6";
  }
};

const enforcementVariant = (value: Draft["enforcement"]): "warning" | "info" | "outline" => {
  switch (value) {
    case "enforce":
      return "warning";
    case "warn":
      return "info";
    default:
      return "outline";
  }
};

const enforcementLabel = (value: Draft["enforcement"]) => {
  switch (value) {
    case "off":
      return "Off";
    case "warn":
      return "Warn";
    case "enforce":
      return "Enforce";
  }
};

/**
 * Tenant-wide OS policy.
 *
 * The page is deliberately explicit about what `enforce` does on each
 * platform: Apple platforms deliver the DDM software-update enforcement
 * declaration (with an explicit ScheduleOSUpdate fallback), while
 * Windows/Android only have update rings. Claiming otherwise would be a lie
 * the fleet view repeats.
 */
export default function OsUpdateSettingsPage() {
  const params = useParams();
  const qc = useQueryClient();
  const { can } = useCan();
  const writable = () => can("devices.write");

  const policy = useQuery(() => enterpriseQueries.osPolicy(params.tenantId));

  const [drafts, setDrafts] = createSignal<Record<string, Draft>>({});

  createEffect(
    () => policy.data,
    (data) => {
      if (!data) return;

      setDrafts(
        Object.fromEntries(data.platforms.map((entry) => [entry.platform, draftFrom(entry)])),
      );
    },
  );

  const draftFor = (platform: OsPolicyPlatform): Draft =>
    drafts()[platform] ?? {
      minimumVersion: "",
      enforcement: "off",
      deferralDays: "0",
    };

  const updateDraft = (platform: OsPolicyPlatform, patch: Partial<Draft>) =>
    setDrafts((current) => ({
      ...current,
      [platform]: { ...draftFor(platform), ...patch },
    }));

  const save = useMutation(() => ({
    mutationFn: (platform: OsPolicyPlatform) => {
      const draft = draftFor(platform);
      const minimumVersion = draft.minimumVersion.trim() || null;
      const deferralDays = Number.parseInt(draft.deferralDays || "0", 10);

      return enterprise.patchTenantOsPolicy(params.tenantId, {
        platforms: [
          {
            platform,
            minimumVersion,
            enforcement: draft.enforcement,
            deferralDays: Number.isFinite(deferralDays) ? deferralDays : 0,
          },
        ],
      });
    },
    onSuccess: async () => {
      toast.success("OS policy saved");
      await qc.invalidateQueries({ queryKey: enterpriseKeys.osPolicy(params.tenantId) });
      await qc.invalidateQueries({ queryKey: enterpriseKeys.osFleet(params.tenantId) });
    },
  }));

  return (
    <div class="grid gap-4">
      <Show when={!writable()}>
        <ReadOnlyNotice>Your role can view the OS policy but not change it.</ReadOnlyNotice>
      </Show>

      <QueryError error={policy.error} onRetry={() => void policy.refetch()} />

      <For each={policy.data?.platforms ?? []}>
        {(platform) => {
          const draft = () => draftFor(platform.platform);

          const enforcingWithoutMinimum = () =>
            draft().enforcement !== "off" && draft().minimumVersion.trim().length === 0;

          const canEnforceMinimum = () => platform.capability.minimumVersionEnforced;

          return (
            <Panel
              title={`${platformLabel(platform.platform)} minimum version`}
              description={platform.capability.description}
              actions={
                <div class="flex items-center gap-2">
                  <Badge variant={enforcementVariant(draft().enforcement)}>
                    {enforcementLabel(draft().enforcement)}
                  </Badge>
                  <Show when={platform.updatedAt}>
                    {(updatedAt) => (
                      <span class="text-xs text-muted-foreground">
                        Saved {new Date(updatedAt()).toLocaleDateString()}
                      </span>
                    )}
                  </Show>
                </div>
              }
            >
              <div class="grid gap-4 p-4 sm:grid-cols-2">
                <Field
                  label="Minimum version"
                  hint={`Dotted version, for example ${versionExample(platform.platform)}.`}
                >
                  <Input
                    value={draft().minimumVersion}
                    disabled={!writable()}
                    placeholder={versionExample(platform.platform)}
                    onInput={(event) =>
                      updateDraft(platform.platform, { minimumVersion: event.currentTarget.value })
                    }
                  />
                </Field>
                <Field label="Enforcement">
                  <NativeSelect
                    value={draft().enforcement}
                    disabled={!writable()}
                    onChange={(event) => {
                      const value = event.currentTarget.value;

                      if (value === "off" || value === "warn" || value === "enforce")
                        updateDraft(platform.platform, { enforcement: value });
                    }}
                  >
                    <option value="off">Off — report nothing</option>
                    <option value="warn">Warn — report, do not change devices</option>
                    <option value="enforce">Enforce — apply the update policy</option>
                  </NativeSelect>
                </Field>
                <Field
                  label="Deferral window"
                  hint={
                    platform.capability.deferralEnforced
                      ? "Days devices get before they count as below minimum. Saving restarts the window."
                      : "Retained for reporting, but this platform cannot apply a deferral deadline."
                  }
                >
                  <Input
                    type="number"
                    min="0"
                    max="365"
                    value={draft().deferralDays}
                    disabled={!writable()}
                    onInput={(event) =>
                      updateDraft(platform.platform, { deferralDays: event.currentTarget.value })
                    }
                  />
                </Field>
                <div class="flex items-end">
                  <Button
                    size="sm"
                    disabled={!writable() || save.isPending || enforcingWithoutMinimum()}
                    onClick={() => save.mutate(platform.platform)}
                  >
                    Save {platformLabel(platform.platform)}
                  </Button>
                </div>
              </div>

              <div class="border-t border-border bg-surface px-4 py-3">
                <p class="text-xs leading-relaxed text-muted-foreground">
                  <span class="font-medium text-foreground">What enforce does here. </span>
                  {platform.capability.description}
                </p>
                <p class="mt-1 text-xs leading-relaxed text-muted-foreground">
                  <span class="font-medium text-foreground">Limitation. </span>
                  {platform.capability.limitation}
                </p>
                <Show when={draft().enforcement === "enforce" && !canEnforceMinimum()}>
                  <p class="mt-2 text-xs leading-relaxed text-warning">
                    This platform has no minimum-version enforcement. Enforcing still applies its
                    update policy, and the minimum remains a compliance check.
                  </p>
                </Show>
                <Show when={enforcingWithoutMinimum()}>
                  <p class="mt-2 text-xs leading-relaxed text-warning">
                    Enter a minimum version before switching this platform on.
                  </p>
                </Show>
              </div>

              <Show when={save.error && save.variables === platform.platform}>
                <div class="px-4 pb-3">
                  <ErrorText error={save.error} />
                </div>
              </Show>
            </Panel>
          );
        }}
      </For>
    </div>
  );
}
