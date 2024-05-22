import { useNavigate } from "@solidjs/router";
import { createEffect } from "solid-js";
import { toast } from "solid-sonner";
import { PageLayoutHeading } from "~/components/PageLayout";
import { isTRPCClientError, trpc } from "~/lib";

export default function Page() {
	const navigate = useNavigate();
	const stats = trpc.internal.stats.createQuery();

	createEffect(() => {
		if (isTRPCClientError(stats.error)) {
			if (stats.error.data?.code === "FORBIDDEN") {
				toast.error("You are not allowed here!");
				navigate("/");
			}
		}
	});

	// TODO: Option to set update channel

	// TODO: Check for updates button
	// TODO: Show current version and latest version
	// TODO: Button to start update

	// TODO: Show deploy progress if we are currently doing an update

	// TODO: List of nodes
	// TODO: Allow removing a node

	return (
		<div class="p-2">
			<PageLayoutHeading>Updates</PageLayoutHeading>

			<p class="text-muted-foreground opacity-70">Coming soon</p>
			{/* <div class="flex flex-col space-y-2">
				<Suspense fallback={<p>Loading...</p>}>
					<For each={stats.data ?? []}>
						{(row) => (
							<p>
								{row.variant}: {row.count}
							</p>
						)}
					</For>
				</Suspense>
			</div> */}
		</div>
	);
}
