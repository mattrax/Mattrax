import { Suspense } from "solid-js";
import { z } from "zod";
import { PageLayout, PageLayoutHeading } from "~/components/PageLayout";
import { createDbQuery } from "~/lib/query";
import { useZodParams } from "~/lib/useZodParams";

export default function Page() {
	const params = useZodParams({
		applicationId: z.string(),
	});

	const data = createDbQuery((db) => db.get("apps", params.applicationId));
	// TODO: 404 handling

	return (
		<PageLayout
			heading={
				<PageLayoutHeading>
					<Suspense fallback={<p>TODO: Loading...</p>}>{data()?.name}</Suspense>
				</PageLayoutHeading>
			}
		>
			<h1 class="text-muted-foreground opacity-70">Coming soon...</h1>
		</PageLayout>
	);
}
