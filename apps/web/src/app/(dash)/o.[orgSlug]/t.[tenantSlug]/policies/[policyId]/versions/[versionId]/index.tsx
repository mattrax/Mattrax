import { PageLayout, PageLayoutHeading } from "~/components/PageLayout";

export default function Page() {
	// TODO: Show diff with buttons to quickly jump to next and previous policies (like GitHub)
	// TODO: Also have a rollback button

	return (
		<PageLayout heading={<PageLayoutHeading>Version</PageLayoutHeading>}>
			<h2 class="text-muted-foreground opacity-70">Coming soon...</h2>
		</PageLayout>
	);
}
