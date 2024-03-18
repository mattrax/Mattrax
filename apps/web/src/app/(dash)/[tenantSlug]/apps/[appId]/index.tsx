import { PageLayout, PageLayoutHeading } from "../../PageLayout";
import { useApp } from "../[appId]";

export default function Page() {
	const app = useApp();

	return (
		<PageLayout heading={<PageLayoutHeading>Overview</PageLayoutHeading>}>
			<h1 class="text-muted-foreground opacity-70">Coming soon...</h1>
		</PageLayout>
	);
}
