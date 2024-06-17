import { Suspense } from "solid-js";
import { PageLayout, PageLayoutHeading } from "~c/PageLayout";
import { useApp } from "../ctx";

export default function Page() {
	const app = useApp();

	return (
		<PageLayout
			heading={
				<PageLayoutHeading>
					<Suspense
						fallback={
							<div class="flex items-center">
								<div class="w-32 h-6 bg-neutral-200 animate-pulse rounded-full" />
							</div>
						}
					>
						{app.data?.name}
					</Suspense>
				</PageLayoutHeading>
			}
		>
			<h1 class="text-muted-foreground opacity-70">Coming soon...</h1>
		</PageLayout>
	);
}
