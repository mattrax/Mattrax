import {
	Button,
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
	DialogContent,
	DialogRoot,
	DialogTrigger,
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@mattrax/ui";
import { createTimeAgo } from "@solid-primitives/date";
import { A } from "@solidjs/router";
import { createColumnHelper } from "@tanstack/solid-table";
import { For, Show, Suspense, createSignal } from "solid-js";
import { match } from "ts-pattern";

import clsx from "clsx";
import createPresence from "solid-presence";
import type { RouterOutput } from "~/api";
import { StandardTable, createStandardTable } from "~/components/StandardTable";
import { trpc } from "~/lib";
import { formatPolicy } from "~/lib/formatPolicy";
import { PageLayout, PageLayoutHeading } from "~c/PageLayout";
import { usePolicyId } from "../../ctx";
import { usePolicy } from "../../ctx";
import { DeployDialog, type Policy, RenderPolicyDiff } from "./dialog";

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
		header: "Comment",
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

	const [dialogRef, setDialogRef] = createSignal<HTMLElement | null>(null);
	const showDialog = () =>
		policy?.data ? policy.data.diff.length !== 0 : false;
	const { present } = createPresence({
		show: showDialog,
		element: dialogRef,
	});

	return (
		<PageLayout heading={<PageLayoutHeading>Deploys</PageLayoutHeading>}>
			<Suspense>
				<Show when={present()}>
					<Card
						ref={setDialogRef}
						class={clsx(
							showDialog() ? "animate-height-in" : "animate-height-out",
						)}
					>
						<CardHeader>
							<div class="flex items-center justify-between">
								<div>
									<CardTitle>Deploy changes</CardTitle>
									<CardDescription>
										The following changes have been made to your policy but have
										not been deployed!
									</CardDescription>
								</div>

								<DeployButton policy={policy.data!} />
							</div>
						</CardHeader>
						<CardContent>
							<RenderPolicyDiff policy={policy.data!} />
						</CardContent>
					</Card>
				</Show>
			</Suspense>
			<StandardTable table={table} />
		</PageLayout>
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
