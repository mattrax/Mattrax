import { PageLayout, PageLayoutHeading } from "../../PageLayout";
import { usePolicy } from "../[policyId]";

export default function Page() {
	const policy = usePolicy();

	return (
		<PageLayout heading={<PageLayoutHeading>Overview</PageLayoutHeading>}>
			<p>Hello</p>
		</PageLayout>
	);
}
