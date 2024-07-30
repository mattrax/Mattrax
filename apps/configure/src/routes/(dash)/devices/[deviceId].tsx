import { createAsync } from "@solidjs/router";
import { Suspense } from "solid-js";
import { z } from "zod";
import { PageLayout, PageLayoutHeading } from "~/components/PageLayout";
import { db } from "~/lib/db";
import { useZodParams } from "~/lib/useZodParams";

export default function Page() {
	const params = useZodParams({
		deviceId: z.string(),
	});

	// TODO: Make this reactive to DB changes
	const data = createAsync(
		async () => await (await db).get("devices", params.deviceId),
	);

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
