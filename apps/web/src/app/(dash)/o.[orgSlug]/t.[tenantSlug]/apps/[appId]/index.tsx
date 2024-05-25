import { PageLayout, PageLayoutHeading } from "~c/PageLayout";
import { trpc } from "~/lib";
import { useZodParams } from "~/lib/useZodParams";
import { z } from "zod";
import { Suspense } from "solid-js";

export default function Page() {
	const params = useZodParams({ appId: z.string() });

	const query = trpc.app.get.createQuery(() => ({
		id: params.appId,
	}));

	return (
		<PageLayout
			heading={
				<PageLayoutHeading>
					<Suspense>{query.data?.name}</Suspense>
				</PageLayoutHeading>
			}
		>
			<h1 class="text-muted-foreground opacity-70">Coming soon...</h1>
		</PageLayout>
	);
}
