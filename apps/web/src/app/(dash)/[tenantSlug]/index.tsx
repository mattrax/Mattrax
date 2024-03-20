import type { RouteDefinition } from "@solidjs/router";
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
import { isDebugMode, trpc, untrackScopeFromSuspense } from "~/lib";
import { PageLayout, PageLayoutHeading } from "./PageLayout";
import type { StatsTarget } from "~/api/trpc/routers/tenant";
import { StatItem } from "~/components/StatItem";
import { useZodParams } from "~/lib/useZodParams";

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
			{isDebugMode() ? (
				<div class="flex">
					<RecentChanges />
				</div>
			) : (
				<div>
					<h1 class="text-muted-foreground opacity-70">
						Dashboard coming soon...
					</h1>
				</div>
			)}
		</PageLayout>
	);
}

function RecentChanges() {
	return (
		<Card>
			<CardHeader>
				<CardTitle>Recent changes</CardTitle>
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
					<div class="flex items-center">
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
					</div>
				</div>
			</CardContent>
		</Card>
	);
}
