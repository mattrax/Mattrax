import { useNavigate } from "@solidjs/router";
import { For, Suspense, createEffect } from "solid-js";
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

	return (
		<div class="p-2">
			<PageLayoutHeading class="pb-4">Overview</PageLayoutHeading>

			<div class="flex flex-col space-y-2">
				<Suspense fallback={<p>Loading...</p>}>
					<For each={stats.data ?? []}>
						{(row) => (
							<p>
								{row.variant}: {row.count}
							</p>
						)}
					</For>
				</Suspense>
			</div>
		</div>
	);
}
