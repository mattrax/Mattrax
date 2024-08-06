import { PageLayout, PageLayoutHeading } from "~c/PageLayout";

export default function Page() {
	return (
		<PageLayout heading={<PageLayoutHeading>Configuration</PageLayoutHeading>}>
			<h1 class="text-muted-foreground opacity-70">Coming soon...</h1>

			{/* // TODO: Show deploy status and the results */}

			{/* // TODO: Os version management maybe */}
		</PageLayout>
	);
}
