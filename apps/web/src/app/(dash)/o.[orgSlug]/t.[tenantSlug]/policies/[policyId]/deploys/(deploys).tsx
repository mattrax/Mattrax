import { withDependantQueries } from "@mattrax/trpc-server-function/client";
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
import { createTimeAgo } from "@solid-primitives/date";
import { A } from "@solidjs/router";
import { createColumnHelper } from "@tanstack/solid-table";
import { For, Show, Suspense, createSignal } from "solid-js";
import { match } from "ts-pattern";

import type { RouterOutput } from "~/api";
import { StandardTable, createStandardTable } from "~/components/StandardTable";
import { trpc } from "~/lib";
import { formatPolicy } from "~/lib/formatPolicy";
import { PageLayout, PageLayoutHeading } from "~c/PageLayout";
import { usePolicyId } from "../../ctx";
import { usePolicy } from "../../ctx";

const column =
	createColumnHelper<RouterOutput["policy"]["deploys"]["list"][number]>();

const columns = [
	column.display({
		id: "number",
		header: "Number",
		cell: ({ row }) => <A href={row.original.id}># {row.index + 1}</A>,
		size: 1,
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

function createDeployTable() {
	const policyId = usePolicyId();

	const deploys = trpc.policy.deploys.list.createQuery(() => ({
		policyId: policyId(),
	}));

	const table = createStandardTable({
		get data() {
			return deploys.data || [];
		},
		columns,
	});

	return { table, deploys };
}

export default function Page() {
	const policy = usePolicy();
	const { table } = createDeployTable();

	return (
		<PageLayout heading={<PageLayoutHeading>Deploys</PageLayoutHeading>}>
			<Suspense>
				<Show when={policy?.data}>
					{(policy) => (
						<Show when={policy().diff.length !== 0}>
							<Card>
								<CardHeader>
									<div class="flex items-center justify-between">
										<div>
											<CardTitle>Deploy changes</CardTitle>
											<CardDescription>
												The following changes have been made to your policy but
												have not been deployed!
											</CardDescription>
										</div>

										<DeployButton policy={policy()} />
									</div>
								</CardHeader>
								<CardContent>
									<RenderPolicyDiff policy={policy()} />
								</CardContent>
							</Card>
						</Show>
					)}
				</Show>
			</Suspense>
			<StandardTable table={table} />
		</PageLayout>
	);
}

type Policy = NonNullable<RouterOutput["policy"]["get"]>;

function RenderPolicyDiff(props: { policy: Policy }) {
	return (
		<For each={props.policy.diff}>
			{(change) => (
				<li>
					<span
						class={match(change.change)
							.with("added", () => "text-green-600")
							.with("modified", () => "text-yellow-600")
							.with("deleted", () => "text-red-600")
							.exhaustive()}
					>
						{formatPolicy(change.data)}
					</span>
				</li>
			)}
		</For>
	);
}

function DeployButton(props: { policy: Policy }) {
	const policyId = usePolicyId();
	const trpcCtx = trpc.useContext();

	return (
		<DialogRoot>
			<DialogTrigger
				as={Button}
				onMouseEnter={() =>
					trpcCtx.policy.overview.ensureData({ id: policyId() })
				}
			>
				Deploy
			</DialogTrigger>
			<DialogContent>
				<DeployDialog policy={props.policy} />
			</DialogContent>
		</DialogRoot>
	);
}

function DeployDialog(props: { policy: Policy }) {
	const [page, setPage] = createSignal(0);
	const controller = useController();
	const policyId = usePolicyId();
	const [comment, setComment] = createSignal("");

	const deploys = trpc.policy.deploys.list.createQuery(() => ({
		policyId: policyId(),
	}));

	const overview = trpc.policy.overview.createQuery(() => ({ id: policyId() }));

	const policy = usePolicy();
	const deploy = trpc.policy.deploy.createMutation(() => ({
		onSuccess: () => controller.setOpen(false),
		...withDependantQueries([policy, deploys]),
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
						<RenderPolicyDiff policy={props.policy} />
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
							deploy.mutate({
								id: policyId(),
								comment: comment(),
							})
						}
						disabled={comment() === "" || deploy.isPending}
					>
						Deploy to {scopedEntities()} entities
					</Button>
				</>
			)}
		</DialogHeader>
	);
}
