import { PageLayout, PageLayoutHeading } from "~c/PageLayout";
import {
	Button,
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogRoot,
	DialogTitle,
	DialogTrigger,
	Textarea,
	Tooltip,
	TooltipContent,
	TooltipTrigger,
	useController,
} from "@mattrax/ui";
import { usePolicy } from "../Context";
import { createSignal, Suspense, For } from "solid-js";
import { trpc } from "~/lib";
import { As } from "@kobalte/core";
import { createColumnHelper } from "@tanstack/solid-table";
import { createTimeAgo } from "@solid-primitives/date";
import type { RouterOutput } from "~/api";
import { A } from "@solidjs/router";
import {
	createStandardTable,
	createSearchParamPagination,
	StandardTable,
} from "~/components/StandardTable";
import { renderStatusBadge } from "../bruh";

const column =
	createColumnHelper<RouterOutput["policy"]["versions"]["list"][number]>();

const columns = [
	column.display({
		id: "number",
		header: "Number",
		cell: ({ row }) => <A href={row.original.id}># {row.index + 1}</A>,
		size: 1,
	}),
	column.accessor("status", {
		header: "Status",
		cell: ({ row }) => renderStatusBadge(row.original.status),
	}),
	column.accessor("author", {
		header: "Author",
		cell: ({ row }) => {
			return (
				<Tooltip>
					<TooltipTrigger>{row.original.author}</TooltipTrigger>
					<TooltipContent>{row.original.authorEmail}</TooltipContent>
				</Tooltip>
			);
		},
	}),
	column.accessor("comment", {
		header: "Deploy comment",
	}),
	column.display({
		id: "deployedAt",
		header: "Deployed at",
		cell: ({ row }) => {
			const [timeago] = createTimeAgo(row.original.deployedAt);
			return (
				<Tooltip>
					<TooltipTrigger>{timeago()}</TooltipTrigger>
					<TooltipContent>
						{row.original.deployedAt.toLocaleString()}
					</TooltipContent>
				</Tooltip>
			);
		},
	}),
];

function createVersionsQuery() {
	const policy = usePolicy();
	return {
		policy,
		versions: trpc.policy.versions.list.useQuery(() => ({
			policyId: policy().id,
		})),
	};
}

function createVersionTable() {
	const { policy, versions } = createVersionsQuery();

	const table = createStandardTable({
		get data() {
			return versions.data || [];
		},
		columns,
		pagination: true,
	});

	createSearchParamPagination(table, "page");

	return { table, policy, versions };
}

export default function Page() {
	const { table, policy } = createVersionTable();

	return (
		<PageLayout heading={<PageLayoutHeading>Versions</PageLayoutHeading>}>
			{policy().isDirty && <DirtyPolicyPanel />}

			<Suspense>
				<StandardTable table={table} />
			</Suspense>
		</PageLayout>
	);
}

function DirtyPolicyPanel() {
	return (
		<Card>
			<CardHeader>
				<div class="flex items-center justify-between">
					<div>
						<CardTitle>Deploy changes</CardTitle>
						<CardDescription>
							The following changes have been made to your policy but have not
							been deployed!
						</CardDescription>
					</div>

					<DeployButton />
				</div>
			</CardHeader>
			<CardContent>
				{/* TODO: Policy diff */}
				{/* <For each={policy().data}>
					{(configuration) => <p>{formatPolicy(configuration)}</p>}
				</For> */}
			</CardContent>
		</Card>
	);
}

function DeployButton() {
	const policy = usePolicy();
	const trpcCtx = trpc.useContext();

	return (
		<DialogRoot>
			<DialogTrigger asChild>
				<As
					component={Button}
					disabled={!(policy().isDirty ?? true)}
					onMouseEnter={() => {
						trpcCtx.policy.overview.ensureData({
							policyId: policy().id,
						});
					}}
				>
					Deploy
				</As>
			</DialogTrigger>
			<DialogContent>
				<DeployDialog />
			</DialogContent>
		</DialogRoot>
	);
}

function DeployDialog() {
	const { policy, versions } = createVersionsQuery();

	const [page, setPage] = createSignal(0);
	const controller = useController();
	const [comment, setComment] = createSignal("");

	const overview = trpc.policy.overview.useQuery(() => ({
		policyId: policy().id,
	}));
	const deployVersion = trpc.policy.deploy.useMutation(() => ({
		onSuccess: async () => {
			Promise.all([policy.query.refetch(), versions.refetch()]);
			await controller.setOpen(false);
		},
	}));

	const scopedEntities = () =>
		(overview.data?.devices || 0) + (overview.data?.users || 0);

	return (
		<DialogHeader>
			<DialogTitle>Deploy changes</DialogTitle>
			<DialogDescription>
				Would you like to deploy the following changes to{" "}
				<b>
					<Suspense fallback="...">{scopedEntities()}</Suspense>
				</b>{" "}
				entities?
			</DialogDescription>
			{page() === 0 && (
				<>
					<ul class="list-disc pl-4 text-md leading-none tracking-tight text-semibold flex flex-col space-y-2 py-2">
						<Suspense fallback="">
							{/* TODO: Policy diff */}
							{/* <For each={Object.entries(getDeploySummary.data?.changes || {})}>
								{([key, value]) => (
									<li>
										<p>{`${key} changed to ${value}`}</p>
									</li>
								)}
							</For> */}
						</Suspense>
					</ul>
					<Button type="button" onClick={() => setPage(1)}>
						Confirm Changes
					</Button>
				</>
			)}
			{page() === 1 && (
				<>
					<Textarea
						placeholder="Provide some context to your team!"
						value={comment()}
						onInput={(e) => setComment(e.currentTarget.value)}
					/>
					<Button
						variant="destructive"
						onClick={() =>
							deployVersion.mutate({
								policyId: policy().id,
								comment: comment(),
							})
						}
						disabled={comment() === ""}
					>
						Deploy to {scopedEntities()} entities
					</Button>
				</>
			)}
		</DialogHeader>
	);
}
