import { PageLayout, PageLayoutHeading } from "~/components/PageLayout";
import { SearchPage, createSearchPageContext } from "~/components/search";

export default function Page() {
	const ctx = createSearchPageContext();
	return (
		<PageLayout heading={<PageLayoutHeading>Search</PageLayoutHeading>}>
			<SearchPage {...ctx} />
		</PageLayout>
	);
}
