import { PageLayout, PageLayoutHeading } from "~c/PageLayout";

export default function Page() {
	return (
		<PageLayout heading={<PageLayoutHeading>Settings</PageLayoutHeading>}>
			<h1 class="text-muted-foreground opacity-70">Coming soon...</h1>

			{/* TODO: Remove device??? */}
		</PageLayout>
	);
}
