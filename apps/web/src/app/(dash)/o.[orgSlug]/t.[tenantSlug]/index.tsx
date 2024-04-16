import { A, type RouteDefinition } from "@solidjs/router";
import { z } from "zod";

import {
  Avatar,
  AvatarFallback,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@mattrax/ui";
import { makeTimer } from "@solid-primitives/timer";
import { getInitials, trpc } from "~/lib";
import { PageLayout, PageLayoutHeading } from "~c/PageLayout";
import type { StatsTarget } from "~/api/trpc/routers/tenant";
import { useZodParams } from "~/lib/useZodParams";
import { type ParentProps, Suspense, For } from "solid-js";
import { useTenantSlug } from "../t.[tenantSlug]";
import { formatAuditLogEvent } from "~/lib/formatAuditLog";
import { createTimeAgo } from "@solid-primitives/date";
import {
  BruhIconPhCheckBold,
  BruhIconPhXBold,
  BruhIconPhAppWindow,
  BruhIconPhDevices,
  BruhIconPhScroll,
  BruhIconPhSelection,
  BruhIconPhUser,
} from "./bruh";
import { StatItem } from "~/components/StatItem";

export const route = {
  load: ({ params }) => {
    trpc
      .useContext()
      .tenant.stats.ensureData({ tenantSlug: params.tenantSlug! });
  },
} satisfies RouteDefinition;

export default function Page() {
  const params = useZodParams({ tenantSlug: z.string() });
  const stats = trpc.tenant.stats.createQuery(() => params);

  console.log({ ...params });

  const getValue = (v: StatsTarget) =>
    stats.data?.find((i) => i.variant === v)?.count ?? 0;

  return (
    <PageLayout heading={<PageLayoutHeading>Dashboard</PageLayoutHeading>}>
      <div class="grid gap-4 grid-cols-5">
        <StatItem
          title="Users"
          href="users"
          icon={<BruhIconPhUser />}
          value={getValue("users")}
        />
        <StatItem
          title="Devices"
          href="devices"
          icon={<BruhIconPhDevices />}
          value={getValue("devices")}
        />
        <StatItem
          title="Policies"
          href="policies"
          icon={<BruhIconPhScroll />}
          value={getValue("policies")}
        />
        <StatItem
          title="Applications"
          href="apps"
          icon={<BruhIconPhAppWindow />}
          value={getValue("applications")}
        />
        <StatItem
          title="Groups"
          href="groups"
          icon={<BruhIconPhSelection />}
          value={getValue("groups")}
        />
      </div>

      <div class="grid gap-4 grid-cols-2">
        <RecentActivity />
        <GettingStarted />
      </div>
    </PageLayout>
  );
}

function RecentActivity() {
  const tenantSlug = useTenantSlug();
  const auditLog = trpc.tenant.auditLog.createQuery(() => ({
    tenantSlug: tenantSlug(),
    limit: 5,
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent activity</CardTitle>
        <CardDescription>
          A timeline of recent activity across your tenant!
        </CardDescription>
      </CardHeader>
      <CardContent class="space-y-3 space-y-reverse">
        <Suspense>
          <div>
            {auditLog.data?.length === 0 && (
              <p class="text-muted-foreground opacity-70">No activity!</p>
            )}
          </div>
          <For each={auditLog.data}>
            {(entry) => {
              const formatted = formatAuditLogEvent(
                entry.action,
                entry.data as any,
              );
              if (formatted === null) return null;

              const [timeago] = createTimeAgo(entry.doneAt);

              const inner = (
                <p class="text-sm font-medium leading-none">
                  {formatted.title}
                </p>
              );

              return (
                <div class="flex items-center">
                  <Avatar class="h-9 w-9">
                    {/* TODO: Finish this */}
                    {/* <AvatarImage src="/avatars/01.png" alt="Avatar" /> */}
                    <AvatarFallback>{getInitials(entry.user)}</AvatarFallback>
                  </Avatar>
                  <div class="ml-4 space-y-1">
                    {formatted.href ? (
                      <A
                        href={formatted.href}
                        class="underline-offset-2 hover:underline"
                      >
                        {inner}
                      </A>
                    ) : (
                      inner
                    )}
                    <p class="text-sm text-muted-foreground">
                      {entry.user} - {timeago()}
                    </p>
                  </div>
                </div>
              );
            }}
          </For>
        </Suspense>
      </CardContent>
    </Card>
  );
}

function GettingStarted() {
  const tenantSlug = useTenantSlug();
  const data = trpc.tenant.gettingStarted.createQuery(() => ({
    tenantSlug: tenantSlug(),
  }));

  makeTimer(
    () => {
      // Keep refetching if setup is not complete (as a device enrollment is done out of band)
      if (!Object.values(data.data || {}).every((v) => v)) data.refetch();
    },
    30 * 1000,
    setTimeout,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Getting Started</CardTitle>
        <CardDescription>
          A guide to getting setup with Mattrax!
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div class="space-y-3">
          <Suspense>
            <GettingStartedRow
              href="settings/identity-provider"
              enabled={data.data?.connectedIdentityProvider || false}
            >
              Connect an identity provider
            </GettingStartedRow>
            <GettingStartedRow
              href="devices"
              enabled={data.data?.enrolledADevice || false}
            >
              Enroll your first device
            </GettingStartedRow>
            <GettingStartedRow
              href="policies"
              enabled={data.data?.createdFirstPolicy || false}
            >
              Create a policy
            </GettingStartedRow>
          </Suspense>
        </div>
      </CardContent>
    </Card>
  );
}

function GettingStartedRow(
  props: ParentProps<{ enabled: boolean; href: string }>,
) {
  return (
    <div class="flex items-center">
      <span class={props.enabled ? "text-green-500" : ""}>
        {props.enabled ? <BruhIconPhCheckBold /> : <BruhIconPhXBold />}
      </span>
      <div class="ml-4 space-y-1">
        <A href={props.href}>
          <p class="text-sm font-medium leading-none underline-offset-2 hover:underline">
            {props.children}
          </p>
        </A>
      </div>
    </div>
  );
}
