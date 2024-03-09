import { PageLayout, PageLayoutHeading } from "../../PageLayout";
import { useDevice } from "../[deviceId]";

export default function Page() {
	const device = useDevice();

	return (
		<PageLayout heading={<PageLayoutHeading>Configuration</PageLayoutHeading>}>
			<h1 class="text-muted-foreground opacity-70">Coming soon...</h1>

			{/* // TODO: Show deploy status and the results */}

			{/* // TODO: Os version management maybe */}
		</PageLayout>
	);
}
