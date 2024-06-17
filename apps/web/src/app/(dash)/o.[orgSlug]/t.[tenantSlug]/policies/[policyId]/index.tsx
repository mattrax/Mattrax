import {
	Avatar,
	AvatarFallback,
	Badge,
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@mattrax/ui";
import { createTimeAgo } from "@solid-primitives/date";
import { A } from "@solidjs/router";
import { For, Show, Suspense } from "solid-js";
import { StatItem } from "~/components/StatItem";
import { getInitials, trpc } from "~/lib";
import { formatPolicy } from "~/lib/formatPolicy";
import { PageLayout, PageLayoutHeading } from "~c/PageLayout";
import { usePolicy, usePolicyId } from "../ctx";

export default function Page() {
	const policyId = usePolicyId();
	const policy = usePolicy();

	const overview = trpc.policy.overview.createQuery(() => ({
		id: policyId(),
	}));

	return (
		<PageLayout
			heading={
				<div class="flex items-center">
					<PageLayoutHeading>Overview</PageLayoutHeading>

					<Suspense>
						<Show when={policy.data}>
							{(policy) => (
								<div class="ml-4">
									{policy().diff.length > 0 && (
										<Tooltip placement="bottom-start">
											<TooltipTrigger>
												<A href="deploys">
													<Badge>Awaiting deploy</Badge>
												</A>
											</TooltipTrigger>
											<TooltipContent>
												This policy has unsaved changes that have not been
												deployed!
											</TooltipContent>
										</Tooltip>
									)}

									{/* TODO: Badge if deployment is in progress */}
								</div>
							)}
						</Show>
					</Suspense>
				</div>
			}
		>
			<div class="grid gap-4 grid-cols-3">
				<StatItem
					title="Devices"
					href="assignees"
					icon={<IconPhDevices />}
					value={overview?.data?.devices || 0}
				/>
				<StatItem
					title="Users"
					href="assignees"
					icon={<IconPhUser />}
					value={overview?.data?.users || 0}
				/>
				<StatItem
					title="Supported"
					href="edit"
					icon={<IconPhPuzzlePiece />}
					body={
						<div class="flex space-x-4">
							<IconLogosMicrosoftWindowsIcon />
							<IconLogosMacos />
							<IconLogosIos />
							<IconLogosAndroidIcon />
							<IconLogosLinuxTux />
						</div>
					}
				/>
			</div>
			<div class="grid gap-4 grid-cols-2">
				<PolicyContent />
				<VersionHistory />
			</div>
		</PageLayout>
	);
}

function PolicyContent() {
	const policy = usePolicy();

	return (
		<Card>
			<CardHeader>
				<CardTitle>Policy content</CardTitle>
				<CardDescription>
					An overview of the settings contained in this policy.
				</CardDescription>
			</CardHeader>
			<CardContent class="space-y-3 space-y-reverse">
				<Suspense>
					<Show when={policy.data}>
						{(policy) => (
							<ul class="list-disc px-4">
								<For
									each={formatPolicy(policy().data)}
									fallback={
										<h2 class="text-muted-foreground opacity-70">
											Policy is empty!
										</h2>
									}
								>
									{(txt) => <li>{txt}</li>}
								</For>
							</ul>
						)}
					</Show>
				</Suspense>
			</CardContent>
		</Card>
	);
}

function VersionHistory() {
	const policyId = usePolicyId();

	const versions = trpc.policy.deploys.list.createQuery(() => ({
		policyId: policyId(),
		limit: 5,
	}));

	return (
		<Card>
			<CardHeader>
				<CardTitle>Recent activity</CardTitle>
				<CardDescription>
					A timeline of recent activity for this policy.
				</CardDescription>
			</CardHeader>
			<CardContent class="space-y-3">
				<Suspense>
					<For each={versions.data}>
						{(version) => {
							const [timeago] = createTimeAgo(version.deployedAt);

							return (
								<div class="flex items-center space-y-reverse">
									<Avatar class="h-9 w-9">
										{/* TODO: Finish this */}
										{/* <AvatarImage src="/avatars/01.png" alt="Avatar" /> */}
										<AvatarFallback>
											{getInitials(version.author || "")}
										</AvatarFallback>
									</Avatar>
									<div class="ml-4 space-y-1">
										<div class="flex flex-col">
											<p>
												<A
													href={`versions/${version.id}`}
													class="underline-offset-2 hover:underline !mb-0"
												>
													{version.comment}
												</A>
											</p>
											<p class="text-sm text-muted-foreground !mt-0">
												{version.author} - {timeago()}
											</p>
										</div>
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
