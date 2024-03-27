import { PageLayout, PageLayoutHeading } from "~c/PageLayout";
import { usePolicy } from "./Context";
import { For, Show, Suspense } from "solid-js";
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
import { StatItem } from "~/components/StatItem";
import {
	BruhIconLogosAndroidIcon,
	BruhIconLogosIos,
	BruhIconLogosLinuxTux,
	BruhIconLogosMacos,
	BruhIconLogosMicrosoftWindowsIcon,
	BruhIconPhDevices,
	BruhIconPhPuzzlePiece,
	BruhIconPhUser,
	renderStatusBadge,
} from "./bruh";
import { A } from "@solidjs/router";
import { formatPolicy } from "~/lib/formatPolicy";
import { getInitials, trpc } from "~/lib";
import { createTimeAgo } from "@solid-primitives/date";

const usePolicyOverview = () => {
	const policy = usePolicy();
	return {
		policy,
		overview: trpc.policy.overview.useQuery(() => ({
			policyId: policy().id,
		})),
	};
};

export default function Page() {
	const { policy, overview } = usePolicyOverview();

	return (
		<PageLayout
			heading={
				<div class="flex items-center">
					<PageLayoutHeading>Overview</PageLayoutHeading>

					<div class="ml-4">
						{policy().diff.length > 0 && (
							<Tooltip placement="bottom-start">
								<TooltipTrigger>
									<A href="versions">
										<Badge>Awaiting deploy</Badge>
									</A>
								</TooltipTrigger>
								<TooltipContent>
									This policy has unsaved changes that have not been deployed!
								</TooltipContent>
							</Tooltip>
						)}

						{/* TODO: Badge if deployment is in progress */}
					</div>
				</div>
			}
		>
			<div class="grid gap-4 grid-cols-3">
				<StatItem
					title="Devices"
					href="assignees"
					icon={<BruhIconPhDevices />}
					value={overview?.latest?.devices || 0}
				/>
				<StatItem
					title="Users"
					href="assignees"
					icon={<BruhIconPhUser />}
					value={overview?.latest?.users || 0}
				/>
				<StatItem
					title="Supported"
					href="edit"
					icon={<BruhIconPhPuzzlePiece />}
					body={
						<div class="flex space-x-4">
							<BruhIconLogosMicrosoftWindowsIcon />
							<BruhIconLogosMacos />
							<BruhIconLogosIos />
							<BruhIconLogosAndroidIcon />
							<BruhIconLogosLinuxTux />
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
				<ul class="list-disc px-4">
					<For
						each={Object.entries(policy().data)}
						fallback={
							<h2 class="text-muted-foreground opacity-70">Policy is empty!</h2>
						}
					>
						{([_, configuration]) => <li>{formatPolicy(configuration)}</li>}
					</For>
				</ul>
			</CardContent>
		</Card>
	);
}

function VersionHistory() {
	const policy = usePolicy();
	const versions = trpc.policy.versions.list.useQuery(() => ({
		policyId: policy().id,
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
											<div class="flex space-x-4">
												<p>
													<A
														href={`versions/${version.id}`}
														class="underline-offset-2 hover:underline !mb-0"
													>
														{version.comment}
													</A>
												</p>
												{renderStatusBadge(version.status)}
											</div>
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
