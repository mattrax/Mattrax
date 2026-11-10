import { useNavigate, useParams } from "@solidjs/router";
import { useQuery } from "@tanstack/solid-query";
import { For, Show } from "solid-js";
import { PageHeader, QueryError } from "~/components/mdm/common";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  CheckCircle2,
  CircleAlert,
  Laptop,
  LinkIcon,
  Settings,
  ShieldCheck,
  UsersRound,
} from "~/components/ui/icons";
import { enterprise, enterpriseKeys } from "~/lib/enterprise";
import type { CredentialInfo } from "~/lib/enterprise";

export default function TenantOverviewPage() {
  const params = useParams();
  const navigate = useNavigate();
  const tenantId = () => params.tenantId!;
  const tenant = useQuery(() => ({
    queryKey: enterpriseKeys.tenant(tenantId()),
    queryFn: () => enterprise.getTenant(tenantId()),
  }));
  const devices = useQuery(() => ({
    queryKey: enterpriseKeys.list(tenantId(), "device"),
    queryFn: () => enterprise.list(tenantId(), "device"),
  }));
  const health = useQuery(() => ({
    queryKey: enterpriseKeys.deviceHealthSummary(tenantId()),
    queryFn: () => enterprise.getDeviceHealthSummary(tenantId()),
  }));
  const pushHealth = useQuery(() => ({
    queryKey: enterpriseKeys.devicePushHealth(tenantId()),
    queryFn: () => enterprise.getDevicePushHealth(tenantId()),
  }));
  const groups = useQuery(() => ({
    queryKey: enterpriseKeys.list(tenantId(), "group"),
    queryFn: () => enterprise.list(tenantId(), "group"),
  }));
  const policies = useQuery(() => ({
    queryKey: enterpriseKeys.list(tenantId(), "policy"),
    queryFn: () => enterprise.list(tenantId(), "policy"),
  }));
  const enrollment = useQuery(() => ({
    queryKey: enterpriseKeys.enrollment(tenantId()),
    queryFn: () => enterprise.getTenantEnrollment(tenantId()),
  }));
  const apns = useQuery(() => ({
    queryKey: enterpriseKeys.apns(tenantId()),
    queryFn: () => enterprise.getApns(tenantId()),
  }));
  const credentials = useQuery(() => ({
    queryKey: enterpriseKeys.credentialHealth(tenantId()),
    queryFn: () => enterprise.getCredentialHealth(tenantId()),
  }));

  const credentialEntries = (): Array<{ label: string; info: CredentialInfo }> => {
    const data = credentials.data;
    if (!data) return [];
    return [
      { label: "APNs certificate", info: data.apns },
      { label: "SCEP CA certificate", info: data.scepCa },
    ];
  };

  const credentialBadgeClass = (level: CredentialInfo["level"]) => {
    switch (level) {
      case "ok":
        return "border-green-200 bg-green-50 text-green-700";
      case "warning":
        return "border-amber-200 bg-amber-50 text-amber-800";
      case "critical":
      case "expired":
        return "border-red-200 bg-red-50 text-red-700";
      default:
        return "border-stone-200 bg-stone-50 text-stone-600";
    }
  };

  const credentialDays = (info: CredentialInfo) => {
    if (!info.configured) return "Not configured";
    if (info.daysLeft == null) return "Expiry unknown";
    if (info.level === "expired")
      return info.daysLeft === 0 ? "Expired" : `Expired ${Math.abs(info.daysLeft)}d ago`;
    if (info.daysLeft === 0) return "Expires today";
    return `${info.daysLeft} day${info.daysLeft === 1 ? "" : "s"} left`;
  };

  const stats = () => [
    {
      label: "Devices",
      value: devices.data?.rows.length ?? 0,
      href: `/t/${tenantId()}/devices`,
      icon: Laptop,
    },
    {
      label: "Groups",
      value: groups.data?.rows.length ?? 0,
      href: `/t/${tenantId()}/groups`,
      icon: UsersRound,
    },
    {
      label: "Policies",
      value: policies.data?.rows.length ?? 0,
      href: `/t/${tenantId()}/policies`,
      icon: ShieldCheck,
    },
  ];

  const pushCards = () => {
    const counts = pushHealth.data?.counts;
    return [
      {
        label: "Configured",
        value: counts?.configured ?? 0,
        href: `/t/${tenantId()}/devices`,
        class: "border-stone-200 bg-stone-50 text-stone-700",
        hint: "Apple devices with a push token",
      },
      {
        label: "Attempted",
        value: counts?.attempted ?? 0,
        href: `/t/${tenantId()}/devices`,
        class: "border-stone-200 bg-stone-50 text-stone-700",
        hint: "Devices with a recorded push",
      },
      {
        label: "Succeeding",
        value: counts?.succeeded ?? 0,
        href: `/t/${tenantId()}/devices`,
        class: "border-green-200 bg-green-50/60 text-green-800",
        hint: "Last push succeeded",
      },
      {
        label: "Failing",
        value: counts?.failing ?? 0,
        href: `/t/${tenantId()}/devices?push=failing`,
        class: "border-amber-200 bg-amber-50/60 text-amber-900",
        hint: "Last push failed",
      },
      {
        label: "Invalid token",
        value: counts?.invalidToken ?? 0,
        href: `/t/${tenantId()}/devices?push=invalid`,
        class: "border-red-200 bg-red-50/60 text-red-800",
        hint: "Device must re-enroll",
      },
    ];
  };

  const healthCards = () => {
    const counts = health.data?.counts;
    return [
      {
        label: "Healthy",
        value: counts?.healthy ?? 0,
        href: `/t/${tenantId()}/devices?health=healthy`,
        class: "border-green-200 bg-green-50/60 text-green-800",
      },
      {
        label: "Attention",
        value: counts?.attention ?? 0,
        href: `/t/${tenantId()}/devices?health=attention`,
        class: "border-amber-200 bg-amber-50/60 text-amber-900",
      },
      {
        label: "Critical",
        value: counts?.critical ?? 0,
        href: `/t/${tenantId()}/devices?health=critical`,
        class: "border-red-200 bg-red-50/60 text-red-800",
      },
      {
        label: "Stale (7d)",
        value: counts?.stale ?? 0,
        // The health summary derives staleness with the same 7-day threshold.
        href: `/t/${tenantId()}/devices?health=stale`,
        class: "border-stone-200 bg-stone-50 text-stone-700",
      },
      {
        label: "Unknown",
        value: counts?.unknown ?? 0,
        href: `/t/${tenantId()}/devices?health=unknown`,
        class: "border-stone-200 bg-stone-50 text-stone-700",
      },
    ];
  };

  return (
    <div class="flex flex-1 flex-col gap-6 p-6">
      <QueryError error={tenant.error} onRetry={() => void tenant.refetch()} />

      <PageHeader
        title={tenant.data?.name ?? "Tenant"}
        description={
          tenant.data ? `Overview for the ${tenant.data.slug} tenant.` : "Loading tenant…"
        }
        actions={
          <Button
            variant="outline"
            onClick={() => navigate(`/t/${tenantId()}/settings/enrollment`)}
          >
            <LinkIcon class="size-4" />
            Enroll a device
          </Button>
        }
      />

      <div class="grid gap-4 sm:grid-cols-3">
        <For each={stats()}>
          {(stat) => (
            <button
              type="button"
              onClick={() => navigate(stat.href)}
              class="flex items-center justify-between rounded-xl border bg-card p-5 text-left transition-colors hover:bg-muted/40"
            >
              <div>
                <p class="text-sm font-medium text-muted-foreground">{stat.label}</p>
                <p class="mt-1 text-3xl font-semibold tracking-tight text-stone-950">
                  {stat.value}
                </p>
              </div>
              <span class="rounded-lg bg-stone-100 p-2.5 text-stone-600">
                <stat.icon class="size-5" />
              </span>
            </button>
          )}
        </For>
      </div>

      <section class="rounded-xl border bg-card p-5">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 class="text-sm font-semibold text-stone-900">Device health</h2>
            <p class="mt-1 text-sm text-muted-foreground">
              Compliance rollup from enrollment, check-in freshness, declaration health, encryption
              and battery posture, and identity state.
            </p>
          </div>
          <Button size="sm" variant="ghost" onClick={() => navigate(`/t/${tenantId()}/devices`)}>
            View devices
          </Button>
        </div>
        <div class="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <For each={healthCards()}>
            {(card) => (
              <button
                type="button"
                onClick={() => navigate(card.href)}
                class={`rounded-lg border p-3 text-left transition-colors hover:brightness-[0.98] ${card.class}`}
              >
                <p class="text-xs font-medium uppercase tracking-wide opacity-80">{card.label}</p>
                <p class="mt-1 text-2xl font-semibold tracking-tight">{card.value}</p>
              </button>
            )}
          </For>
        </div>
        <Show when={health.isError}>
          <QueryError error={health.error} class="mt-3" onRetry={() => void health.refetch()} />
        </Show>
      </section>

      <section class="rounded-xl border bg-card p-5">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 class="text-sm font-semibold text-stone-900">Apple push delivery</h2>
            <p class="mt-1 text-sm text-muted-foreground">
              Whether APNs wake-ups reach enrolled Apple devices. An invalid token means the device
              must enroll again.
            </p>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => navigate(`/t/${tenantId()}/devices?push=failing`)}
          >
            View failing
          </Button>
        </div>
        <div class="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <For each={pushCards()}>
            {(card) => (
              <button
                type="button"
                title={card.hint}
                onClick={() => navigate(card.href)}
                class={`rounded-lg border p-3 text-left transition-colors hover:brightness-[0.98] ${card.class}`}
              >
                <p class="text-xs font-medium uppercase tracking-wide opacity-80">{card.label}</p>
                <p class="mt-1 text-2xl font-semibold tracking-tight">{card.value}</p>
              </button>
            )}
          </For>
        </div>
        <Show when={(pushHealth.data?.recentFailures.length ?? 0) > 0}>
          <ul class="mt-4 divide-y rounded-lg border">
            <For each={pushHealth.data?.recentFailures ?? []}>
              {(failure) => (
                <li class="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                  <span class="font-medium text-stone-900">{failure.deviceName}</span>
                  <span class="text-xs text-muted-foreground">
                    {failure.errorCode === "invalid_token" ? "Invalid token" : "Delivery failed"} ·{" "}
                    {failure.consecutiveFailures} consecutive
                  </span>
                </li>
              )}
            </For>
          </ul>
        </Show>
        <Show when={pushHealth.isError}>
          <QueryError
            error={pushHealth.error}
            class="mt-3"
            onRetry={() => void pushHealth.refetch()}
          />
        </Show>
      </section>

      <div class="grid gap-4 lg:grid-cols-2">
        <section class="rounded-xl border bg-card p-5">
          <div class="flex items-center justify-between">
            <h2 class="text-sm font-semibold text-stone-900">Enrollment</h2>
            <Badge variant={enrollment.data?.enabledApple ? "default" : "outline"}>
              {enrollment.data?.enabledApple ? "Enabled" : "Disabled"}
            </Badge>
          </div>
          <p class="mt-1 text-sm text-muted-foreground">
            Share the enrollment link with users, or configure the tenant in settings.
          </p>
          <div class="mt-4 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => navigate(`/t/${tenantId()}/settings/enrollment`)}>
              <LinkIcon class="size-4" />
              Enrollment settings
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => navigate(`/t/${tenantId()}/settings`)}
            >
              <Settings class="size-4" />
              Tenant settings
            </Button>
          </div>
          <Show when={enrollment.isSuccess && !enrollment.data?.enabledApple}>
            <p class="mt-3 flex items-center gap-2 text-xs text-amber-700">
              <CircleAlert class="size-3.5" />
              Apple enrollment is turned off for this tenant.
            </p>
          </Show>
        </section>

        <section class="rounded-xl border bg-card p-5">
          <div class="flex items-center justify-between">
            <h2 class="text-sm font-semibold text-stone-900">Apple push notifications</h2>
            <Badge variant={apns.data?.configured ? "default" : "outline"}>
              {apns.data?.configured ? "Configured" : "Setup required"}
            </Badge>
          </div>
          <p class="mt-1 text-sm text-muted-foreground">
            APNs is how Mattrax wakes enrolled Apple devices to apply policy changes.
          </p>
          <div class="mt-4">
            <Show
              when={apns.data?.configured}
              fallback={
                <Button
                  size="sm"
                  onClick={() => navigate(`/t/${tenantId()}/settings/management`)}
                  variant="outline"
                >
                  <CircleAlert class="size-4" />
                  Set up APNs
                </Button>
              }
            >
              <div class="flex flex-wrap items-center gap-2 text-sm text-green-700">
                <CheckCircle2 class="size-4" />
                <span>{apns.data?.topic ?? "Topic configured"}</span>
                <Show when={apns.data?.expiresAt}>
                  <span class="text-xs text-muted-foreground">
                    expires {new Date(apns.data!.expiresAt!).toLocaleDateString()}
                  </span>
                </Show>
              </div>
            </Show>
          </div>
        </section>
      </div>

      <section class="rounded-xl border bg-card p-5">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 class="text-sm font-semibold text-stone-900">Credentials</h2>
            <p class="mt-1 text-sm text-muted-foreground">
              Apple push and SCEP signing certificates, plus device identity expiry.
            </p>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => navigate(`/t/${tenantId()}/settings/management`)}
          >
            Manage credentials
          </Button>
        </div>
        <Show
          when={credentials.data}
          fallback={
            <Show
              when={credentials.isError}
              fallback={<p class="mt-3 text-sm text-muted-foreground">Loading credentials…</p>}
            >
              <QueryError
                error={credentials.error}
                class="mt-3"
                onRetry={() => void credentials.refetch()}
              />
            </Show>
          }
        >
          <ul class="mt-4 divide-y rounded-lg border">
            <For each={credentialEntries()}>
              {(entry) => (
                <li class="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                  <span class="font-medium text-stone-900">{entry.label}</span>
                  <span class="flex items-center gap-2 text-xs">
                    <Show when={entry.info.expiresAt}>
                      <span class="text-muted-foreground">
                        expires{" "}
                        {new Date(entry.info.expiresAt!).toLocaleDateString(undefined, {
                          dateStyle: "medium",
                        })}
                      </span>
                    </Show>
                    <span
                      class={`rounded-full border px-2 py-0.5 ${credentialBadgeClass(entry.info.level)}`}
                    >
                      {credentialDays(entry.info)}
                    </span>
                  </span>
                </li>
              )}
            </For>
            <li class="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
              <span class="font-medium text-stone-900">Device identity certificates</span>
              <span class="flex flex-wrap items-center gap-2 text-xs">
                <span class="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-amber-800">
                  {credentials.data!.deviceCertificates.expiringSoon} expiring in 30d
                </span>
                <span class="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-red-700">
                  {credentials.data!.deviceCertificates.expired} expired
                </span>
                <span class="rounded-full border border-stone-200 bg-stone-50 px-2 py-0.5 text-stone-600">
                  {credentials.data!.deviceCertificates.revoked} revoked
                </span>
              </span>
            </li>
          </ul>
        </Show>
      </section>

      <section class="rounded-xl border bg-card">
        <div class="flex items-center justify-between border-b px-5 py-4">
          <h2 class="text-sm font-semibold text-stone-900">Recent devices</h2>
          <Button size="sm" variant="ghost" onClick={() => navigate(`/t/${tenantId()}/devices`)}>
            View all
          </Button>
        </div>
        <Show
          when={(devices.data?.rows.length ?? 0) > 0}
          fallback={
            <div class="p-8 text-center text-sm text-muted-foreground">
              No devices have enrolled yet.
            </div>
          }
        >
          <ul class="divide-y">
            <For each={devices.data?.rows.slice(0, 5) ?? []}>
              {(device) => (
                <li>
                  <button
                    type="button"
                    onClick={() => navigate(`/t/${tenantId()}/devices/${device.id}`)}
                    class="flex w-full items-center justify-between px-5 py-3 text-left hover:bg-muted/30"
                  >
                    <span>
                      <span class="block text-sm font-medium text-stone-900">{device.name}</span>
                      <span class="block text-xs text-muted-foreground">
                        {device.model ?? device.serial ?? device.id}
                      </span>
                    </span>
                    <Badge variant={device.status === "enrolled" ? "default" : "secondary"}>
                      {device.status}
                    </Badge>
                  </button>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </section>
    </div>
  );
}
