import { useNavigate } from "@solidjs/router";
import { useQuery } from "@tanstack/solid-query";
import { For, Show } from "solid-js";
import { EmptyState, PageHeader } from "~/components/mdm/common";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  CheckCircle2,
  CircleAlert,
  Laptop,
  LinkIcon,
  Plus,
  Settings,
  ShieldCheck,
  UsersRound,
} from "~/components/ui/icons";
import { enterprise, enterpriseKeys, resolveActiveTenant } from "~/lib/enterprise";

export default function DashboardPage() {
  const navigate = useNavigate();
  const me = useQuery(() => ({ queryKey: enterpriseKeys.me(), queryFn: enterprise.me }));
  const tenant = () => resolveActiveTenant(me.data);

  return (
    <Show
      when={tenant()}
      fallback={
        <div class="flex flex-1 flex-col gap-6 p-6">
          <PageHeader
            title="Dashboard"
            description="Create a tenant to start managing devices."
          />
          <Show when={me.isSuccess}>
            <EmptyState
              title="No tenant yet"
              description="Tenants hold your devices, groups, policies, and team. Create one to get started."
              action={
                <Button onClick={() => navigate("/tenants/new")}>
                  <Plus class="size-4" />
                  Create tenant
                </Button>
              }
            />
          </Show>
        </div>
      }
    >
      {(active) => <DashboardContent tenantId={active().id} tenantName={active().name} tenantSlug={active().slug} />}
    </Show>
  );
}

function DashboardContent(props: { tenantId: string; tenantName: string; tenantSlug: string }) {
  const navigate = useNavigate();
  const devices = useQuery(() => ({
    queryKey: enterpriseKeys.list(props.tenantId, "device"),
    queryFn: () => enterprise.list(props.tenantId, "device"),
  }));
  const groups = useQuery(() => ({
    queryKey: enterpriseKeys.list(props.tenantId, "group"),
    queryFn: () => enterprise.list(props.tenantId, "group"),
  }));
  const policies = useQuery(() => ({
    queryKey: enterpriseKeys.list(props.tenantId, "policy"),
    queryFn: () => enterprise.list(props.tenantId, "policy"),
  }));
  const enrollment = useQuery(() => ({
    queryKey: enterpriseKeys.enrollment(props.tenantId),
    queryFn: () => enterprise.getTenantEnrollment(props.tenantId),
  }));
  const apns = useQuery(() => ({
    queryKey: enterpriseKeys.apns(props.tenantId),
    queryFn: () => enterprise.getApns(props.tenantId),
  }));

  const stats = () => [
    {
      label: "Devices",
      value: devices.data?.rows.length ?? 0,
      href: `/t/${props.tenantId}/devices`,
      icon: Laptop,
    },
    {
      label: "Groups",
      value: groups.data?.rows.length ?? 0,
      href: `/t/${props.tenantId}/groups`,
      icon: UsersRound,
    },
    {
      label: "Policies",
      value: policies.data?.rows.length ?? 0,
      href: `/t/${props.tenantId}/policies`,
      icon: ShieldCheck,
    },
  ];

  return (
    <div class="flex flex-1 flex-col gap-6 p-6">
      <PageHeader
        title={props.tenantName}
        description={`Overview for the ${props.tenantSlug} tenant.`}
        actions={
          <Button variant="outline" onClick={() => navigate(`/t/${props.tenantId}/settings/enrollment`)}>
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
            <Button size="sm" onClick={() => navigate(`/t/${props.tenantId}/settings/enrollment`)}>
              <LinkIcon class="size-4" />
              Enrollment settings
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => navigate(`/t/${props.tenantId}/settings`)}
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
                  onClick={() => navigate(`/t/${props.tenantId}/settings`)}
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

      <section class="rounded-xl border bg-card">
        <div class="flex items-center justify-between border-b px-5 py-4">
          <h2 class="text-sm font-semibold text-stone-900">Recent devices</h2>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => navigate(`/t/${props.tenantId}/devices`)}
          >
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
                    onClick={() => navigate(`/t/${props.tenantId}/devices/${device.id}`)}
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
