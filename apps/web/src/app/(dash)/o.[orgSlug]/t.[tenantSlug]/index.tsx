import { A, type RouteDefinition } from "@solidjs/router";
import { z } from "zod";

import {
	Avatar,
	AvatarFallback,
	AvatarImage,
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@mattrax/ui";
import { makeTimer } from "@solid-primitives/timer";
import { trpc } from "~/lib";
import { PageLayout, PageLayoutHeading } from "~c/PageLayout";
import type { StatsTarget } from "~/api/trpc/routers/tenant";
import { StatItem } from "~c/StatItem";
import { useZodParams } from "~/lib/useZodParams";
import { BruhIconPhCheckBold, BruhIconPhXBold } from "./bruh";
import { type ParentProps, Suspense } from "solid-js";
import { useTenantSlug } from "../t.[tenantSlug]";

export const route = {
	load: ({ params }) => {
		trpc
			.useContext()
			.tenant.stats.ensureData({ tenantSlug: params.tenantSlug! });
	},
} satisfies RouteDefinition;

export default function Page() {
	const params = useZodParams({ tenantSlug: z.string() });
	const stats = trpc.tenant.stats.useQuery(() => params);

	const getValue = (v: StatsTarget) =>
		stats.latest?.find((i) => i.variant === v)?.count ?? 0;

	return (
		<PageLayout heading={<PageLayoutHeading>Dashboard</PageLayoutHeading>}>
			<dl class="gap-5 flex">
				<StatItem title="Users" value={getValue("users")} />
				<StatItem title="Devices" value={getValue("devices")} />
				<StatItem title="Policies" value={getValue("policies")} />
				<StatItem title="Applications" value={getValue("applications")} />
				<StatItem title="Groups" value={getValue("groups")} />
			</dl>
			<div class="flex space-x-4">
				<RecentActivity />
				<GettingStarted />
			</div>
		</PageLayout>
	);
}

function RecentActivity() {
	return (
		<Card>
			<CardHeader>
				<CardTitle>Recent activity</CardTitle>
				<CardDescription>
					A timeline of recent events in your tenant!
				</CardDescription>
			</CardHeader>
			<CardContent>
				<div class="space-y-8">
					<div class="flex items-center">
						<Avatar class="h-9 w-9">
							<AvatarImage src="/avatars/01.png" alt="Avatar" />
							<AvatarFallback>OM</AvatarFallback>
						</Avatar>
						<div class="ml-4 space-y-1">
							<p class="text-sm font-medium leading-none">Olivia Martin</p>
							<p class="text-sm text-muted-foreground">
								olivia.martin@email.com
							</p>
						</div>
						<div class="ml-auto font-medium">+$1,999.00</div>
					</div>
					{/* <div class="flex items-center">
						<Avatar class="flex h-9 w-9 items-center justify-center space-y-0 border">
							<AvatarImage src="/avatars/02.png" alt="Avatar" />
							<AvatarFallback>JL</AvatarFallback>
						</Avatar>
						<div class="ml-4 space-y-1">
							<p class="text-sm font-medium leading-none">Jackson Lee</p>
							<p class="text-sm text-muted-foreground">jackson.lee@email.com</p>
						</div>
						<div class="ml-auto font-medium">+$39.00</div>
					</div>
					<div class="flex items-center">
						<Avatar class="h-9 w-9">
							<AvatarImage src="/avatars/03.png" alt="Avatar" />
							<AvatarFallback>IN</AvatarFallback>
						</Avatar>
						<div class="ml-4 space-y-1">
							<p class="text-sm font-medium leading-none">Isabella Nguyen</p>
							<p class="text-sm text-muted-foreground">
								isabella.nguyen@email.com
							</p>
						</div>
						<div class="ml-auto font-medium">+$299.00</div>
					</div>
					<div class="flex items-center">
						<Avatar class="h-9 w-9">
							<AvatarImage src="/avatars/04.png" alt="Avatar" />
							<AvatarFallback>WK</AvatarFallback>
						</Avatar>
						<div class="ml-4 space-y-1">
							<p class="text-sm font-medium leading-none">William Kim</p>
							<p class="text-sm text-muted-foreground">will@email.com</p>
						</div>
						<div class="ml-auto font-medium">+$99.00</div>
					</div>
					<div class="flex items-center">
						<Avatar class="h-9 w-9">
							<AvatarImage src="/avatars/05.png" alt="Avatar" />
							<AvatarFallback>SD</AvatarFallback>
						</Avatar>
						<div class="ml-4 space-y-1">
							<p class="text-sm font-medium leading-none">Sofia Davis</p>
							<p class="text-sm text-muted-foreground">sofia.davis@email.com</p>
						</div>
						<div class="ml-auto font-medium">+$39.00</div>
					</div> */}
				</div>
			</CardContent>
		</Card>
	);
}

function GettingStarted() {
	const tenantSlug = useTenantSlug();
	const data = trpc.tenant.gettingStarted.useQuery(() => ({
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
							enabled={data.data?.enrolledADevice || false}
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
