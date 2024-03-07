import { PageLayout, PageLayoutHeading } from "../../PageLayout";
import { useUser } from "../[userId]";

export default function Page() {
	const user = useUser();

	return (
		<PageLayout heading={<PageLayoutHeading>Scope</PageLayoutHeading>}>
			<h1>Coming soon</h1>
		</PageLayout>
	);
}
