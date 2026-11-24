import { useParams } from "@solidjs/router";
import type { RoutePreloadFuncArgs } from "@solidjs/router";
import { useNavigate } from "~/lib/navigation";
import { useMutation, useQueryClient } from "@tanstack/solid-query";
import { Match } from "effect";
import { createSignal, lazy, Loading, onSettled, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import { DEFAULT_BRAND_COLOR, normalizeBrandColor } from "@mattrax/enterprise-domain/client";
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
import { flagOf, regionName } from "~/components/region-label";
import { useTenantProfileDraft } from "~/components/settings/tenant-profile-draft";
import { enterprise, enterpriseKeys, enterpriseQueries } from "~/lib/enterprise";
import { preloadPage } from "~/lib/page-data";
import { queryClient } from "~/lib/query-client";
import { ReadOnlyNotice, useCan } from "~/lib/permissions";

export const route = {
  preload: ({ params, intent }: RoutePreloadFuncArgs) => {
    if (intent === "initial") return;

    // Backups are permission-gated and live on their own page, so the general
    // form only needs the tenant row here.
    return preloadPage([
      () => queryClient.ensureQueryData(enterpriseQueries.tenant(params.tenantId)),
    ]);
  },
};

/**
 * The globe (d3-geo plus the world geometry) is only needed after the
 * operator reaches the region field. Keep its chunk out of the settings entry
 * and show a matching, interactive trigger until the chunk is warm.
 */
const LazyRegionPicker = lazy(() =>
  import("~/components/region-picker").then((module) => ({ default: module.RegionPicker })),
);

function RegionPickerFallback(props: {
  value: string;
  disabled?: boolean;
  onActivate?: () => void;
}) {
  return (
    <button
      type="button"
      disabled={props.disabled}
      onClick={() => props.onActivate?.()}
      class="flex h-9 w-full items-center gap-2 rounded-md border border-input bg-card px-2.5 text-left text-[13px] text-foreground outline-none transition-[border-color,box-shadow] duration-[var(--duration-hover)] ease-swift hover:border-border-strong focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <Show
        when={props.value}
        fallback={
          <span class="min-w-0 flex-1 truncate text-muted-foreground">Use default (US)</span>
        }
      >
        <span class="shrink-0 text-[15px] leading-none">{flagOf(props.value)}</span>
        <span class="min-w-0 flex-1 truncate">{regionName(props.value)}</span>
        <span class="shrink-0 font-mono text-[10.5px] text-muted-foreground">
          {props.value.toUpperCase()}
        </span>
      </Show>
      <span class="ml-auto size-3.5 shrink-0 text-muted-foreground" aria-hidden="true">
        ▾
      </span>
    </button>
  );
}

export default function GeneralSettingsPage() {
  const params = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { can } = useCan();
  const draft = useTenantProfileDraft();
  const {
    name,
    setName,
    slug,
    setSlug,
    displayName,
    setDisplayName,
    logo,
    setLogo,
    supportEmail,
    setSupportEmail,
    brandColor,
    setBrandColor,
    appStoreRegion,
    setAppStoreRegion,
    autoUnlink,
    setAutoUnlink,
    brandingErrors,
    tenant,
  } = draft;
  const canWrite = draft.canWrite;
  const canDelete = () => can("tenant.delete");

  const [confirm, setConfirm] = createSignal("");
  const [deleteOpen, setDeleteOpen] = createSignal(false);
  const [regionPickerReady, setRegionPickerReady] = createSignal(false);
  const [regionPickerPending, setRegionPickerPending] = createSignal(false);

  const activateRegionPicker = () => {
    setRegionPickerPending(true);
    setRegionPickerReady(true);
  };

  // Warm the picker chunk after the form has painted. The placeholder stays
  // until the operator clicks, so focus is never moved by a background swap.
  onSettled(() => {
    void import("~/components/region-picker");
  });

  const colorValue = () => normalizeBrandColor(brandColor() || "") ?? DEFAULT_BRAND_COLOR;

  const del = useMutation(() => ({
    mutationFn: () => enterprise.deleteTenant(params.tenantId),
    onSuccess: async (result) => {
      setDeleteResult(result);
      await qc.invalidateQueries({ queryKey: enterpriseKeys.me() });
    },
  }));

  const [deleteResult, setDeleteResult] = createSignal<{
    reclaimed: {
      devices: number;
      contacted: number;
      unreachableDevices: ReadonlyArray<{
        id: string;
        name: string;
        platform: string;
        reason: string;
      }>;
      objects: number;
      subscription: string;
    };
  } | null>(null);

  return (
    <div class="grid gap-5">
      <QueryError error={tenant.error} onRetry={() => void tenant.refetch()} />

      <Panel
        title="Tenant profile"
        description="The identifiers, name and branding shown across the dashboard and enrollment pages."
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            draft.requestSave();
          }}
        >
          <div class="divide-y divide-border">
            <ReadOnlyRow
              label="Tenant ID"
              hint="Stable identifier used by the API and device enrollment. It never changes, even when the slug does."
            >
              <span class="block break-all font-mono text-[12px] text-muted-foreground">
                {tenant.data?.id ?? "…"}
              </span>
            </ReadOnlyRow>
            <ReadOnlyRow label="Created" hint="When this tenant was provisioned.">
              <span class="text-[13px] text-muted-foreground">
                {tenant.data ? new Date(tenant.data.createdAt).toLocaleDateString() : "…"}
              </span>
            </ReadOnlyRow>
            <FieldRow label="Name" hint="Internal tenant name used by the dashboard.">
              <Input
                disabled={!canWrite()}
                value={name()}
                onInput={(e) => setName(e.currentTarget.value)}
                required
              />
            </FieldRow>
            <FieldRow
              label="Slug"
              hint="Used in dashboard URLs, for example /t/your-slug. Changing it rewrites every shared tenant link; old id links redirect to the new URL."
            >
              <Input
                disabled={!canWrite()}
                value={slug()}
                pattern="[a-z0-9\-]+"
                onInput={(e) => setSlug(e.currentTarget.value.toLowerCase())}
                required
              />
            </FieldRow>
            <FieldRow
              label="Display name"
              hint="Shown on the enrollment page, Apple profile and tenant emails. Falls back to the name above."
            >
              <Input
                disabled={!canWrite()}
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
                disabled={!canWrite()}
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
                disabled={!canWrite()}
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
                  disabled={!canWrite()}
                  class="h-8 w-11 shrink-0 cursor-pointer rounded-md border border-input bg-surface p-1 transition-colors duration-[var(--duration-hover)] ease-swift hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                  value={colorValue()}
                  onInput={(e) => setBrandColor(e.currentTarget.value)}
                />
                <Input
                  aria-label="Brand colour hex value"
                  disabled={!canWrite()}
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
            <FieldRow
              label="App Store region"
              hint="Storefront used to resolve an App Store ID when a device does not report one. Defaults to the United States."
            >
              <Show
                when={regionPickerReady()}
                fallback={
                  <RegionPickerFallback
                    value={appStoreRegion()}
                    disabled={!canWrite()}
                    onActivate={activateRegionPicker}
                  />
                }
              >
                <Loading
                  fallback={
                    <RegionPickerFallback
                      value={appStoreRegion()}
                      disabled={!canWrite()}
                      onActivate={activateRegionPicker}
                    />
                  }
                >
                  <LazyRegionPicker
                    value={appStoreRegion()}
                    disabled={!canWrite()}
                    onChange={setAppStoreRegion}
                    initialOpen={regionPickerPending()}
                  />
                </Loading>
              </Show>
            </FieldRow>
            <FieldRow
              label="Unlink unavailable apps"
              hint="When an availability check finds the app in none of its storefronts, remove its assignments automatically. The catalogue row and install history are kept."
            >
              <label class="flex items-center gap-2 text-[13px] text-foreground">
                <input
                  type="checkbox"
                  class="size-3.5 accent-[var(--brand-solid)]"
                  disabled={!canWrite()}
                  checked={autoUnlink()}
                  onChange={(e) => setAutoUnlink(e.currentTarget.checked)}
                />
                Unlink assignments when every storefront loses the app
              </label>
            </FieldRow>
          </div>
          <Show when={!canWrite()}>
            <ReadOnlyNotice class="mt-3">
              Your role can view these settings but not change them.
            </ReadOnlyNotice>
          </Show>
        </form>
      </Panel>

      <Show when={canDelete()}>
        <Panel
          class="border-destructive/20 bg-destructive/[0.015]"
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
                Enrolled devices are sent their platform's unenroll request, the billing
                subscription is cancelled, all tenant files and backups are deleted, then the tenant
                is removed. Offline and Windows devices usually still need manual removal; the
                result lists every device that could not be fully released.
              </p>
              <ErrorText error={del.error} />
            </div>
            <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
              Delete tenant
            </Button>
          </div>
        </Panel>

        <Dialog
          open={deleteOpen()}
          onOpenChange={(open) => {
            setDeleteOpen(open);

            if (!open && deleteResult()) navigate("/dashboard");
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete {tenant.data?.name ?? "tenant"}?</DialogTitle>
              <DialogDescription>
                Devices get an unenroll request, billing is cancelled, and every file and backup is
                deleted before the tenant is removed. If any step fails, the tenant is kept so you
                can retry. Type the tenant slug{" "}
                <span class="font-mono font-medium">{tenant.data?.slug}</span> to confirm.
              </DialogDescription>
            </DialogHeader>
            <Show
              when={deleteResult()}
              fallback={
                <>
                  <Input
                    value={confirm()}
                    onInput={(e) => setConfirm(e.currentTarget.value)}
                    placeholder={tenant.data?.slug}
                  />
                  <ErrorText error={del.error} />
                </>
              }
            >
              {(result) => (
                <div class="space-y-2 rounded-lg border border-border bg-surface p-3 text-sm">
                  <p class="font-medium text-success">Tenant deleted</p>
                  <p class="text-muted-foreground">
                    {result().reclaimed.contacted} of {result().reclaimed.devices} enrolled device
                    {result().reclaimed.devices === 1 ? "" : "s"} contacted,{" "}
                    {result().reclaimed.objects} stored object
                    {result().reclaimed.objects === 1 ? "" : "s"} deleted,{" "}
                    {Match.value(result().reclaimed.subscription).pipe(
                      Match.when("cancelled", () => "subscription cancelled"),
                      Match.when("at_period_end", () => "subscription ends at period end"),
                      Match.orElse(() => "no billing subscription"),
                    )}
                    .
                  </p>
                  <Show when={result().reclaimed.unreachableDevices.length > 0}>
                    <div class="space-y-1">
                      <p class="text-xs font-medium text-destructive">
                        These devices could not be reached and still need manual removal:
                      </p>
                      <ul class="space-y-1 text-xs text-muted-foreground">
                        {result().reclaimed.unreachableDevices.map((device) => (
                          <li>
                            <span class="font-medium text-foreground">{device.name}</span> (
                            {device.platform}) — {device.reason}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </Show>
                </div>
              )}
            </Show>
            <DialogFooter>
              <Show
                when={deleteResult()}
                fallback={
                  <>
                    <Button variant="outline" onClick={() => setDeleteOpen(false)}>
                      Cancel
                    </Button>
                    <Button
                      variant="destructive"
                      disabled={confirm() !== tenant.data?.slug || del.isPending}
                      onClick={() => del.mutate()}
                    >
                      {del.isPending ? "Deleting…" : "Delete tenant"}
                    </Button>
                  </>
                }
              >
                <Button onClick={() => navigate("/dashboard")}>Go to dashboard</Button>
              </Show>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </Show>
    </div>
  );
}

/** A form row in the OpenCode-console style: label and hint on the left, the
 * control pinned to the right on desktop and stacked on narrow screens. */
function ReadOnlyRow(props: { label: string; hint?: string; children: JSX.Element }) {
  return (
    <div class="flex flex-col gap-2 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between sm:gap-8">
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
      <span class="w-full min-w-0 sm:w-[22rem] sm:shrink-0">{props.children}</span>
    </div>
  );
}

function FieldRow(props: { label: string; hint?: string; children: JSX.Element }) {
  return (
    <label class="flex flex-col gap-2 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between sm:gap-8 [&_input:not([type=checkbox]):not([type=color])]:h-9">
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
      <span class="w-full min-w-0 sm:w-[22rem] sm:shrink-0">{props.children}</span>
    </label>
  );
}
