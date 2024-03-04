import { useNavigate } from "@solidjs/router";
import { For, createEffect } from "solid-js";
import { isTRPCClientError, trpc } from "~/lib";

export default function Page() {
	const navigate = useNavigate();
	const stats = trpc.internal.stats.useQuery();

	createEffect(() => {
		if (isTRPCClientError(stats.error)) {
			if (stats.error.data?.code === "FORBIDDEN") navigate("/");
		}
	});

	return (
		<div class="p-2">
			<a href="/" class="hover:underline">
				Back to Dashboard
			</a>
			<h1 class="text-4xl pb-4">Top-secret dashboard</h1>
			<div class="flex flex-col space-y-2">
				<For each={stats.data ?? []}>
					{(row) => (
						<p>
							{row.variant}: {row.count}
						</p>
					)}
				</For>
			</div>
		</div>
	);
}
