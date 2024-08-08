import { Suspense } from "solid-js";
import { z } from "zod";
import { PageLayout, PageLayoutHeading } from "~/components/PageLayout";
import { createDbQuery } from "~/lib/query";
import { useZodParams } from "~/lib/useZodParams";

export default function Page() {
	const params = useZodParams({
		scriptId: z.string(),
	});

	const data = createDbQuery((db) => db.get("scripts", params.scriptId));
	// TODO: 404 handling

	return (
		<PageLayout
			heading={
				<div class="flex items-center space-x-4 p-4 w-full">
					<IconPhTerminal class="w-20 h-20" />

					<div>
						<h1 class="text-3xl font-bold">
							<Suspense
								fallback={
									<div class="w-42 h-8 rounded-full bg-neutral-200 animate-pulse" />
								}
							>
								{data()?.name}
							</Suspense>
						</h1>
						<h2 class="flex items-center mt-1 opacity-80 text-sm font-semibold uppercase tracking-tight">
							{/* // TODO: Type bash or batch */}
							<Suspense
								fallback={
									<div class="w-52 h-4 rounded-full bg-neutral-200 animate-pulse" />
								}
							>
								Batch
							</Suspense>
						</h2>
					</div>
				</div>
			}
		>
			{/* // TODO: Why is scriptContent not found */}
			{/* // TODO: Editor */}
			<pre>{data()?.scriptContent ?? "nope"}</pre>
		</PageLayout>
	);
}
