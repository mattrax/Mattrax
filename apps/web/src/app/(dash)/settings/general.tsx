import { useNavigate } from "@solidjs/router";
import { For, Suspense, createEffect } from "solid-js";
import { toast } from "solid-sonner";
import { isTRPCClientError, trpc } from "~/lib";

export default function Page() {
	const navigate = useNavigate();
	const stats = trpc.internal.stats.useQuery();

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
			<h1 class="text-4xl pb-4">Mattrax Installation Stats</h1>
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
