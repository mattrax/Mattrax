import { useNavigate, useParams } from "@solidjs/router";
import { useQuery } from "@tanstack/solid-query";
import { For, Show } from "solid-js";
import {
  DeviceStatusBadge,
  Page,
  PageHeader,
  Panel,
  QueryError,
  StatCard,
} from "~/components/mdm/common";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Check,
  ChevronRight,
  CircleAlert,
  Laptop,
  LinkIcon,
  Settings,
  ShieldCheck,
  UsersRound,
} from "~/components/ui/icons";
import { enterprise, enterpriseKeys } from "~/lib/enterprise";
import type { CredentialInfo } from "~/lib/enterprise";
import { cn } from "~/lib/utils";

const tenantInitials = (name: string | undefined) => {
  if (!name) return "?";
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
};

const credentialBadgeClass = (level: CredentialInfo["level"]) => {
  switch (level) {
    case "ok":
      return "border-success/25 bg-success/10 text-success-foreground";
    case "warning":
      return "border-warning/25 bg-warning/10 text-warning-foreground";
    case "critical":
    case "expired":
      return "border-destructive/25 bg-destructive/10 text-destructive";
    default:
      return "border-white/[0.08] bg-white/[0.03] text-muted-foreground";
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

/** A single setup task in the onboarding checklist. */
function SetupStep(props: {
  index: number;
  title: string;
  description: string;
  done: boolean;
  href: string;
  action: string;
}) {
  return (
    <a
      href={props.href}
      class="group flex items-start gap-2.5 rounded-lg px-2 py-2.5 outline-none transition-colors hover:bg-white/[0.035] focus-visible:ring-2 focus-visible:ring-ring/60"
    >
      <span
        class={cn(
          "mt-px flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold tabular-nums",
          props.done
            ? "border-success/30 bg-success/15 text-success-foreground"
            : "border-white/[0.1] bg-white/[0.03] text-muted-foreground",
        )}
      >
        <Show when={props.done} fallback={props.index}>
          <Check class="size-3" aria-hidden="true" />
        </Show>
      </span>
      <span class="min-w-0 flex-1">
        <span
          class={cn(
            "block text-[12.5px] font-medium leading-snug",
            props.done ? "text-muted-foreground" : "text-foreground",
          )}
        >
          {props.title}
        </span>
        <span class="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground/80">
          {props.description}
        </span>
      </span>
      <Show when={!props.done}>
        <span class="mt-px flex shrink-0 items-center gap-0.5 text-[11px] font-medium text-brand">
          {props.action}
          <ChevronRight class="size-3" aria-hidden="true" />
        </span>
      </Show>
    </a>
  );
}

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

  const healthTotal = () => {
    const counts = health.data?.counts;
    if (!counts) return 0;
    return Math.max(counts.total ?? 0, counts.healthy + counts.attention + counts.critical);
  };

  const healthCards = () => {
    const counts = health.data?.counts;
    return [
      {
        label: "Healthy",
        value: counts?.healthy ?? 0,
        href: `/t/${tenantId()}/devices?health=healthy`,
        dot: "bg-success",
      },
      {
        label: "Attention",
        value: counts?.attention ?? 0,
        href: `/t/${tenantId()}/devices?health=attention`,
        dot: "bg-warning",
      },
      {
        label: "Critical",
        value: counts?.critical ?? 0,
        href: `/t/${tenantId()}/devices?health=critical`,
        dot: "bg-destructive",
      },
      {
        label: "Stale (7d)",
        value: counts?.stale ?? 0,
        // The health summary derives staleness with the same 7-day threshold.
        href: `/t/${tenantId()}/devices?health=stale`,
        dot: "bg-muted-foreground/50",
      },
      {
        label: "Unknown",
        value: counts?.unknown ?? 0,
        href: `/t/${tenantId()}/devices?health=unknown`,
        dot: "bg-muted-foreground/30",
      },
    ];
  };

  const healthSegments = () => {
    const counts = health.data?.counts;
    const total = healthTotal();
    return [
      { label: "Healthy", value: counts?.healthy ?? 0, class: "bg-success", total },
      { label: "Attention", value: counts?.attention ?? 0, class: "bg-warning", total },
      { label: "Critical", value: counts?.critical ?? 0, class: "bg-destructive", total },
    ];
  };

  const pushCards = () => {
    const counts = pushHealth.data?.counts;
    return [
      {
        label: "Configured",
        value: counts?.configured ?? 0,
        href: `/t/${tenantId()}/devices`,
        dot: "bg-brand",
        hint: "Apple devices with a push token",
      },
      {
        label: "Attempted",
        value: counts?.attempted ?? 0,
        href: `/t/${tenantId()}/devices`,
        dot: "bg-muted-foreground/50",
        hint: "Devices with a recorded push",
      },
      {
        label: "Succeeding",
        value: counts?.succeeded ?? 0,
        href: `/t/${tenantId()}/devices`,
        dot: "bg-success",
        hint: "Last push succeeded",
      },
      {
        label: "Failing",
        value: counts?.failing ?? 0,
        href: `/t/${tenantId()}/devices?push=failing`,
        dot: "bg-warning",
        hint: "Last push failed",
      },
      {
        label: "Invalid token",
        value: counts?.invalidToken ?? 0,
        href: `/t/${tenantId()}/devices?push=invalid`,
        dot: "bg-destructive",
        hint: "Device must re-enroll",
      },
    ];
  };

  const setupSteps = () => [
    {
      title: "Connect Apple push",
      description: "Upload an APNs certificate so policy changes wake devices.",
      done: apns.data?.configured === true,
      href: `/t/${tenantId()}/settings/management`,
      action: "Set up",
    },
    {
      title: "Configure SCEP",
      description: "Sign device identity certificates with a SCEP CA.",
      done: credentials.data?.scepCa.configured === true,
      href: `/t/${tenantId()}/settings/management`,
      action: "Configure",
    },
    {
      title: "Enable enrollment",
      description: "Turn on the enrollment links your users will visit.",
      done: enrollment.data?.enabledApple === true,
      href: `/t/${tenantId()}/settings/enrollment`,
      action: "Enable",
    },
    {
      title: "Enroll the first device",
      description: "A device appears here as soon as it checks in.",
      done: (devices.data?.rows.length ?? 0) > 0,
      href: `/t/${tenantId()}/settings/enrollment`,
      action: "Enroll",
    },
  ];

  const setupDone = () => setupSteps().filter((step) => step.done).length;
  const setupProgress = () => Math.round((setupDone() / setupSteps().length) * 100);

  return (
    <Page class="gap-6">
      <QueryError error={tenant.error} onRetry={() => void tenant.refetch()} />

      <div class="flex min-w-0 items-start gap-3.5">
        <span class="mt-0.5 flex size-11 shrink-0 items-center justify-center rounded-xl border border-white/[0.08] bg-gradient-to-b from-white/[0.1] to-white/[0.02] text-[13px] font-semibold tracking-wide text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]">
          {tenantInitials(tenant.data?.displayName ?? tenant.data?.name)}
        </span>
        <div class="min-w-0 flex-1">
          <PageHeader
            eyebrow="Tenant"
            title={tenant.data?.displayName ?? tenant.data?.name ?? "Tenant"}
            meta={
              <Show when={tenant.data} fallback={<span>Loading tenant…</span>}>
                {(detail) => (
                  <>
                    <Badge variant="outline" class="capitalize text-muted-foreground">
                      {detail().role}
                    </Badge>
                    <span class="text-muted-foreground/40" aria-hidden="true">
                      ·
                    </span>
                    <span class="break-all font-mono text-[11px]">{detail().slug}</span>
                  </>
                )}
              </Show>
            }
            actions={
              <Button variant="outline" onClick={() => navigate(`/t/${tenantId()}/settings`)}>
                <Settings class="size-4" />
                Tenant settings
              </Button>
            }
          />
        </div>
      </div>

      <div class="grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Devices"
          value={devices.data?.rows.length ?? 0}
          hint="Managed enrollments"
          href={`/t/${tenantId()}/devices`}
          icon={Laptop}
        />
        <StatCard
          label="Groups"
          value={groups.data?.rows.length ?? 0}
          hint="Static and smart groups"
          href={`/t/${tenantId()}/groups`}
          icon={UsersRound}
        />
        <StatCard
          label="Policies"
          value={policies.data?.rows.length ?? 0}
          hint="Configuration profiles"
          href={`/t/${tenantId()}/policies`}
          icon={ShieldCheck}
        />
      </div>

      <div class="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,336px)] xl:gap-6">
        <div class="flex min-w-0 flex-col gap-5">
          <Panel
            title="Device health"
            description="Compliance rollup from enrollment, check-in freshness, declaration health, encryption and battery posture, and identity state."
            actions={
              <Button
                size="sm"
                variant="ghost"
                onClick={() => navigate(`/t/${tenantId()}/devices`)}
              >
                View devices
              </Button>
            }
          >
            <div class="flex items-end justify-between gap-3">
              <p class="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                Fleet mix
              </p>
              <p class="text-[11px] text-muted-foreground">
                <span class="text-[13px] font-semibold tabular-nums text-foreground">
                  {healthTotal()}
                </span>{" "}
                devices
              </p>
            </div>
            <div class="mt-2 flex h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
              <Show when={healthTotal() > 0}>
                <For each={healthSegments()}>
                  {(segment) => (
                    <Show when={segment.value > 0}>
                      <div
                        class={segment.class}
                        style={{ width: `${(segment.value / segment.total) * 100}%` }}
                        title={`${segment.label}: ${segment.value}`}
                      />
                    </Show>
                  )}
                </For>
              </Show>
            </div>
            <div class="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
              <For each={healthCards()}>
                {(card) => (
                  <button
                    type="button"
                    onClick={() => navigate(card.href)}
                    class="group flex min-w-0 flex-col gap-1.5 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 text-left transition-colors hover:border-white/[0.12] hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                  >
                    <span class="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                      <span class={cn("size-1.5 rounded-full", card.dot)} aria-hidden="true" />
                      <span class="truncate">{card.label}</span>
                    </span>
                    <span class="text-[18px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-foreground">
                      {card.value}
                    </span>
                  </button>
                )}
              </For>
            </div>
            <Show when={health.isError}>
              <QueryError error={health.error} class="mt-3" onRetry={() => void health.refetch()} />
            </Show>
          </Panel>

          <Panel
            title="Apple push delivery"
            description="Whether APNs wake-ups reach enrolled Apple devices. An invalid token means the device must enroll again."
            actions={
              <Button
                size="sm"
                variant="ghost"
                onClick={() => navigate(`/t/${tenantId()}/devices?push=failing`)}
              >
                View failing
              </Button>
            }
          >
            <div class="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
              <For each={pushCards()}>
                {(card) => (
                  <a
                    href={card.href}
                    title={card.hint}
                    class="group flex min-w-0 flex-col gap-1.5 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 transition-colors hover:border-white/[0.12] hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                  >
                    <span class="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                      <span class={cn("size-1.5 rounded-full", card.dot)} aria-hidden="true" />
                      <span class="truncate">{card.label}</span>
                    </span>
                    <span class="text-[18px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-foreground">
                      {card.value}
                    </span>
                  </a>
                )}
              </For>
            </div>
            <Show when={(pushHealth.data?.recentFailures.length ?? 0) > 0}>
              <ul class="mt-4 divide-y divide-white/[0.06] overflow-hidden rounded-lg border border-white/[0.07]">
                <For each={pushHealth.data?.recentFailures ?? []}>
                  {(failure) => (
                    <li class="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-[12.5px]">
                      <span class="font-medium text-foreground">{failure.deviceName}</span>
                      <span class="text-[11px] text-muted-foreground">
                        {failure.errorCode === "invalid_token"
                          ? "Invalid token"
                          : "Delivery failed"}{" "}
                        · {failure.consecutiveFailures} consecutive
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
          </Panel>

          <Panel
            title="Recent devices"
            flush
            actions={
              <Button
                size="sm"
                variant="ghost"
                onClick={() => navigate(`/t/${tenantId()}/devices`)}
              >
                View all
              </Button>
            }
          >
            <Show
              when={(devices.data?.rows.length ?? 0) > 0}
              fallback={
                <div class="px-5 py-10 text-center">
                  <p class="text-[13px] font-medium text-foreground">No devices yet</p>
                  <p class="mt-1 text-[12px] text-muted-foreground">
                    Enroll a device and it will show up here after its first check-in.
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    class="mt-3"
                    onClick={() => navigate(`/t/${tenantId()}/settings/enrollment`)}
                  >
                    <LinkIcon class="size-4" />
                    Enroll a device
                  </Button>
                </div>
              }
            >
              <ul class="divide-y divide-white/[0.06]">
                <For each={devices.data?.rows.slice(0, 5) ?? []}>
                  {(device) => (
                    <li>
                      <button
                        type="button"
                        onClick={() => navigate(`/t/${tenantId()}/devices/${device.id}`)}
                        class="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-white/[0.025] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60 sm:px-5"
                      >
                        <span class="min-w-0">
                          <span class="block truncate text-[13px] font-medium text-foreground">
                            {device.name}
                          </span>
                          <span class="block truncate text-[11.5px] text-muted-foreground">
                            {device.model ?? device.serial ?? device.id}
                          </span>
                        </span>
                        <DeviceStatusBadge status={device.status} />
                      </button>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </Panel>
        </div>

        <div class="flex min-w-0 flex-col gap-5">
          <Panel
            title="Get started"
            description="Finish these steps to put the tenant into production."
          >
            <div class="flex items-center justify-between gap-2">
              <p class="text-[11.5px] text-muted-foreground">
                <span class="font-medium text-foreground">{setupDone()}</span> of{" "}
                {setupSteps().length} complete
              </p>
              <p class="text-[11px] font-medium tabular-nums text-muted-foreground">
                {setupProgress()}%
              </p>
            </div>
            <div class="mt-2 h-1 w-full overflow-hidden rounded-full bg-white/[0.06]">
              <div
                class="h-full rounded-full bg-brand transition-[width] duration-500"
                style={{ width: `${setupProgress()}%` }}
              />
            </div>
            <div class="mt-3 -mx-1 divide-y divide-white/[0.05]">
              <For each={setupSteps()}>
                {(step, index) => (
                  <SetupStep
                    index={index() + 1}
                    title={step.title}
                    description={step.description}
                    done={step.done}
                    href={step.href}
                    action={step.action}
                  />
                )}
              </For>
            </div>
          </Panel>

          <Panel
            title="Enrollment"
            description="Share the enrollment link with users, or configure the tenant in settings."
            actions={
              <Badge variant={enrollment.data?.enabledApple ? "default" : "outline"}>
                {enrollment.data?.enabledApple ? "Enabled" : "Disabled"}
              </Badge>
            }
          >
            <Show when={enrollment.data?.code}>
              {(code) => (
                <div class="mb-3 rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2">
                  <p class="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                    Enrollment code
                  </p>
                  <p class="mt-0.5 truncate font-mono text-[12.5px] text-foreground">{code()}</p>
                </div>
              )}
            </Show>
            <div class="flex flex-wrap gap-2">
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
              <p class="mt-3 flex items-start gap-2 text-[11.5px] leading-relaxed text-warning-foreground">
                <CircleAlert class="mt-px size-3.5 shrink-0" />
                Apple enrollment is turned off for this tenant.
              </p>
            </Show>
            <Show when={enrollment.data}>
              {(data) => (
                <p class="mt-3 border-t border-white/[0.06] pt-3 text-[11px] text-muted-foreground">
                  Up to <span class="text-foreground">{data().maxDevices}</span> devices · Windows{" "}
                  {data().enabledWindows ? "on" : "off"} · Android{" "}
                  {data().enabledAndroid ? "on" : "off"}
                </p>
              )}
            </Show>
          </Panel>

          <Panel
            title="Credentials"
            description="Apple push and SCEP signing certificates, plus device identity expiry."
            actions={
              <Button
                size="sm"
                variant="ghost"
                onClick={() => navigate(`/t/${tenantId()}/settings/management`)}
              >
                Manage credentials
              </Button>
            }
          >
            <Show
              when={credentials.data}
              fallback={
                <Show
                  when={credentials.isError}
                  fallback={<p class="text-[12.5px] text-muted-foreground">Loading credentials…</p>}
                >
                  <QueryError
                    error={credentials.error}
                    onRetry={() => void credentials.refetch()}
                  />
                </Show>
              }
            >
              {(data) => (
                <ul class="divide-y divide-white/[0.06] overflow-hidden rounded-lg border border-white/[0.07]">
                  <For each={credentialEntries()}>
                    {(entry) => (
                      <li class="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 px-3 py-2.5">
                        <span class="text-[12.5px] font-medium text-foreground">{entry.label}</span>
                        <span class="flex flex-wrap items-center gap-2 text-[11px]">
                          <Show when={entry.info.expiresAt}>
                            <span class="text-muted-foreground">
                              expires{" "}
                              {new Date(entry.info.expiresAt!).toLocaleDateString(undefined, {
                                dateStyle: "medium",
                              })}
                            </span>
                          </Show>
                          <span
                            class={cn(
                              "rounded-full border px-2 py-0.5 font-medium",
                              credentialBadgeClass(entry.info.level),
                            )}
                          >
                            {credentialDays(entry.info)}
                          </span>
                        </span>
                      </li>
                    )}
                  </For>
                  <li class="px-3 py-2.5">
                    <p class="text-[12.5px] font-medium text-foreground">
                      Device identity certificates
                    </p>
                    <div class="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                      <span class="rounded-full border border-warning/25 bg-warning/10 px-2 py-0.5 text-warning-foreground">
                        {data().deviceCertificates.expiringSoon} expiring in 30d
                      </span>
                      <span class="rounded-full border border-destructive/25 bg-destructive/10 px-2 py-0.5 text-destructive">
                        {data().deviceCertificates.expired} expired
                      </span>
                      <span class="rounded-full border border-white/[0.08] bg-white/[0.03] px-2 py-0.5 text-muted-foreground">
                        {data().deviceCertificates.revoked} revoked
                      </span>
                    </div>
                  </li>
                </ul>
              )}
            </Show>
            <Show when={apns.data?.configured}>
              <p class="mt-3 text-[11px] leading-relaxed text-muted-foreground">
                APNs topic{" "}
                <span class="break-all font-mono text-foreground">
                  {apns.data?.topic ?? "configured"}
                </span>
                <Show when={apns.data?.expiresAt}>
                  {" "}
                  · expires {new Date(apns.data!.expiresAt!).toLocaleDateString()}
                </Show>
              </p>
            </Show>
          </Panel>
        </div>
      </div>
    </Page>
  );
}
