import { A, type RouteDefinition } from "@solidjs/router";

import {
	Avatar,
	AvatarFallback,
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@mattrax/ui";
import { createTimeAgo } from "@solid-primitives/date";
import { makeTimer } from "@solid-primitives/timer";
import clsx from "clsx";
import { For, type ParentProps, Suspense } from "solid-js";
import type { StatsTarget } from "~/api/trpc/routers/tenant";
import { StatItem } from "~/components/StatItem";
import { getInitials, trpc } from "~/lib";
import { formatAuditLogEvent } from "~/lib/formatAuditLog";
import { PageLayout, PageLayoutHeading } from "~c/PageLayout";
import { useTenantSlug } from "./ctx";

export const route = {
	load: ({ params }) => {
		const ctx = trpc.useContext();

		ctx.tenant.stats.ensureData({ tenantSlug: params.tenantSlug! });
		ctx.tenant.auditLog.ensureData({
			tenantSlug: params.tenantSlug!,
			limit: 5,
		});
		ctx.tenant.gettingStarted.ensureData({
			tenantSlug: params.tenantSlug!,
		});
	},
} satisfies RouteDefinition;

export default function Page() {
	const tenantSlug = useTenantSlug();
	const stats = trpc.tenant.stats.createQuery(() => ({
		tenantSlug: tenantSlug(),
	}));

	const getValue = (v: StatsTarget) =>
		stats.data?.find((i) => i.variant === v)?.count;

	return (
		<PageLayout heading={<PageLayoutHeading>Dashboard</PageLayoutHeading>}>
			<div class="grid gap-4 grid-cols-5">
				<StatItem
					title="Users"
					href="users"
					icon={<IconPhUser />}
					value={getValue("users")}
				/>
				<StatItem
					title="Devices"
					href="devices"
					icon={<IconPhDevices />}
					value={getValue("devices")}
				/>
				<StatItem
					title="Policies"
					href="policies"
					icon={<IconPhScroll />}
					value={getValue("policies")}
				/>
				<StatItem
					title="Applications"
					href="apps"
					icon={<IconPhAppWindow />}
					value={getValue("applications")}
				/>
				<StatItem
					title="Groups"
					href="groups"
					icon={<IconPhSelection />}
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
							disabled={data.isLoading}
						>
							Connect an identity provider
						</GettingStartedRow>
						<GettingStartedRow
							href="devices"
							enabled={data.data?.enrolledADevice || false}
							disabled={data.isLoading}
						>
							Enroll your first device
						</GettingStartedRow>
						<GettingStartedRow
							href="policies"
							enabled={data.data?.createdFirstPolicy || false}
							disabled={data.isLoading}
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
	props: ParentProps<{ enabled: boolean; href: string; disabled?: boolean }>,
) {
	return (
		<div class="flex items-center">
			<Suspense
				fallback={
					<span>
						<IconSvgSpinners90Ring />
					</span>
				}
			>
				<span class={props.enabled ? "text-green-500" : ""}>
					{props.enabled ? <IconPhCheckBold /> : <IconPhXBold />}
				</span>
			</Suspense>
			<div class="ml-4 space-y-1">
				<A href={props.href}>
					<p
						class={clsx(
							"text-sm font-medium leading-none underline-offset-2 hover:underline transition-opacity",
							props.disabled && "opacity-60",
						)}
					>
						{props.children}
					</p>
				</A>
			</div>
		</div>
	);
}
