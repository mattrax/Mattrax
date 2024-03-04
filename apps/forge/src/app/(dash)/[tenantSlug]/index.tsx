import Counter from "~/components/Counter";
import {
	Avatar,
	AvatarFallback,
	AvatarImage,
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "~/components/ui";
import { isDebugMode, trpc, untrackScopeFromSuspense } from "~/lib";
import { useTenant } from "../[tenantSlug]";
import { PageLayout, PageLayoutHeading } from "./PageLayout";

export default function Page() {
	const tenant = useTenant();
	const stats = trpc.tenant.stats.useQuery(() => ({
		tenantSlug: tenant().slug,
	}));

	const data = untrackScopeFromSuspense(() => ({ ...stats.data }));

	return (
		<PageLayout heading={<PageLayoutHeading>Dashboard</PageLayoutHeading>}>
			<dl class="gap-5 flex">
				<StatItem title="Users" value={data().users ?? 0} />
				<StatItem title="Devices" value={data().devices ?? 0} />
				<StatItem title="Policies" value={data().policies ?? 0} />
				<StatItem title="Applications" value={data().applications ?? 0} />
				<StatItem title="Groups" value={data().groups ?? 0} />
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

function StatItem(props: { title: string; value: number }) {
	return (
		<div class="rounded-lg bg-gray-100 dark:bg-brandDark px-4 py-5 shadow sm:p-6">
			<span class="truncate text-sm font-medium ">{props.title}</span>
			<Counter value={props.value} duration={1700}>
				{(count) => (
					<dd class="mt-1 text-3xl font-semibold tracking-tight">
						{count().toLocaleString()}
					</dd>
				)}
			</Counter>
		</div>
	);
}

export function RecentChanges() {
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
