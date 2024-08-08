import { PageLayout, PageLayoutHeading } from "~/components/PageLayout";
import { SearchPage, createSearchPageContext } from "~/components/search";

export default function Page() {
	const ctx = createSearchPageContext([
		{
			type: "enum",
			target: "type",
			value: "scripts",
		},
	]);

	return (
		<PageLayout heading={<PageLayoutHeading>Scripts</PageLayoutHeading>}>
			<SearchPage {...ctx} showFilterBar={false} />
		</PageLayout>
	);
}
