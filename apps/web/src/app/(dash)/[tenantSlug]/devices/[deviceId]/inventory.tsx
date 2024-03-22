import { PageLayout, PageLayoutHeading } from "~/app/(dash)/PageLayout";
import { useDevice } from "./Context";

export default function Page() {
	const device = useDevice();

	return (
		<PageLayout heading={<PageLayoutHeading>Inventory</PageLayoutHeading>}>
			<h1 class="text-muted-foreground opacity-70">Coming soon...</h1>

			{/* // TODO: Apps */}

			{/* // TODO: Local users */}
		</PageLayout>
	);
}
