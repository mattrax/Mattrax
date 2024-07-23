import { PageLayout, PageLayoutHeading } from "~/components/PageLayout";
import { SearchPage, createSearchPageContext } from "~/components/search";

export default function Page() {
	const ctx = createSearchPageContext([
		{
			type: "enum",
			target: "type",
			value: "groups",
		},
	]);

	return (
		<PageLayout heading={<PageLayoutHeading>Groups</PageLayoutHeading>}>
			<SearchPage {...ctx} showFilterBar={false} />
		</PageLayout>
	);
}
