import { withDependantQueries } from "@mattrax/trpc-server-function/client";
import {
	Button,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	Textarea,
	useController,
} from "@mattrax/ui";
import {
	For,
	Match,
	Show,
	Suspense,
	Switch,
	createMemo,
	createSignal,
} from "solid-js";
import { match } from "ts-pattern";

import clsx from "clsx";
import createPresence from "solid-presence";
import { toast } from "solid-sonner";
import type { RouterOutput } from "~/api";
import { trpc } from "~/lib";
import { formatPolicy } from "~/lib/formatPolicy";
import { usePolicyId } from "../../ctx";
import { usePolicy } from "../../ctx";

export function DeployDialog(props: { policy: Policy }) {
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
		onError: (err) => {
			if (err.data?.code === "PRECONDITION_FAILED") {
				controller.setOpen(false);
				toast.error(
					"The policy could not be deployed as it has not been modified!",
					{
						id: "policy-not-modified",
					},
				);
			}
		},
		onSuccess: () => controller.setOpen(false),
		...withDependantQueries([policy, deploys]),
	}));

	const scopedEntities = () =>
		(overview.data?.devices || 0) + (overview.data?.users || 0);

	const error = createMemo<typeof deploy.error>(
		// @ts-expect-error
		(prevValue) => {
			if (deploy.isPending) return prevValue;
			return deploy.error;
		},
	);

	const [errorRef, setErrorRef] = createSignal<HTMLElement | null>(null);

	const { present } = createPresence({
		show: () => !!error(),
		element: errorRef,
	});

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
			<Switch>
				<Match when={page() === 0}>
					<ul class="list-disc pl-4 text-md leading-none tracking-tight text-semibold flex flex-col space-y-2 py-2">
						<RenderPolicyDiff policy={props.policy} />
					</ul>
					<Button type="button" onClick={() => setPage(1)}>
						Confirm Changes
					</Button>
				</Match>
				<Match when={page() === 1}>
					{/* This div is so the flex space doesn't cause issues with the animation */}
					<div>
						<Show when={present()}>
							<p
								ref={setErrorRef}
								class={clsx(
									"text-red-600 text-sm transition-all duration-300 ease-in-out",
									error()
										? "animate-in fade-in-0 max-h-screen"
										: "animate-out fade-out-0 max-h-0",
								)}
							>
								{error()?.message}
							</p>
						</Show>
						<Textarea
							class="mt-1.5"
							placeholder="Provide some context to your team!"
							value={comment()}
							onInput={(e) => setComment(e.currentTarget.value)}
						/>
					</div>
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
				</Match>
			</Switch>
		</DialogHeader>
	);
}

export type Policy = NonNullable<RouterOutput["policy"]["get"]>;

export function RenderPolicyDiff(props: { policy: Policy }) {
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
