import { PageLayout, PageLayoutHeading } from "../../PageLayout";
import { useDevice } from "./Context";

export default function Page() {
	const device = useDevice();

	return (
		<PageLayout heading={<PageLayoutHeading>Settings</PageLayoutHeading>}>
			<h1 class="text-muted-foreground opacity-70">Coming soon...</h1>

			{/* TODO: Remove device??? */}
		</PageLayout>
	);
}
