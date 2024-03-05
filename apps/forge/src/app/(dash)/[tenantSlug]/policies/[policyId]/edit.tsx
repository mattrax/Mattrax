import {
	DialogContent,
	DialogRoot,
	DialogTrigger,
	Textarea,
	Button,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	useController,
} from "~/components/ui";
import { PageLayout, PageLayoutHeading } from "../../PageLayout";
import { usePolicy } from "../[policyId]";
import { As } from "@kobalte/core";
import { trpc } from "~/lib";
import { useTenant } from "~/app/(dash)/[tenantSlug]";
import { For, Suspense, createSignal } from "solid-js";

export default function Page() {
	const policy = usePolicy();

	return (
		<PageLayout
			heading={
				<div class="flex justify-between w-full items-center">
					<PageLayoutHeading>Edit</PageLayoutHeading>
					<DeployButton />
				</div>
			}
		>
			<p>TODO</p>
		</PageLayout>
	);
}

function DeployButton() {
	const tenant = useTenant();
	const policy = usePolicy();
	const trpcCtx = trpc.useContext();

	return (
		<DialogRoot>
			<DialogTrigger asChild>
				<As
					component={Button}
					disabled={!(policy.data?.isDirty ?? true)}
					onMouseEnter={() => {
						if (policy.data)
							trpcCtx.policy.getDeploySummary.ensureData({
								tenantSlug: tenant().slug,
								policyId: policy.data.id,
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
	const policy = usePolicy();
	const [page, setPage] = createSignal(0);
	const controller = useController();
	const [comment, setComment] = createSignal("");

	const tenant = useTenant();
	const getDeploySummary = trpc.policy.getDeploySummary.useQuery({
		tenantSlug: tenant().slug,
		policyId: policy.data?.id,
	});

	const deployVersion = trpc.policy.deploy.useMutation(() => ({
		onSuccess: async () => {
			await policy.refetch();
			controller.setOpen(false);
		},
	}));

	return (
		<DialogHeader>
			<DialogTitle>Deploy changes</DialogTitle>
			<DialogDescription>
				Would you like to deploy the following changes to{" "}
				<b>
					<Suspense fallback="...">{getDeploySummary.data?.numScoped}</Suspense>
				</b>{" "}
				entities?
			</DialogDescription>
			{page() === 0 && (
				<>
					<ul class="list-disc pl-4 text-md leading-none tracking-tight text-semibold flex flex-col space-y-2 py-2">
						<Suspense fallback="">
							<For each={Object.entries(getDeploySummary.data?.changes || {})}>
								{([key, value]) => (
									<li>
										<p>{`${key} changed to ${value}`}</p>
									</li>
								)}
							</For>
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
						onChange={(e) => setComment(e.currentTarget.value)}
					/>
					<Button
						variant="destructive"
						onClick={() =>
							deployVersion.mutate({
								tenantSlug: tenant().slug,
								policyId: policy.data?.id,
								comment: comment(),
							})
						}
					>
						Deploy to {getDeploySummary.data?.numScoped} entities
					</Button>
				</>
			)}
		</DialogHeader>
	);
}
