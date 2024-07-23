import { PageLayout, PageLayoutHeading } from "~/components/PageLayout";
import { SearchPage, createSearchPageContext } from "~/components/search";

export default function Page() {
	const ctx = createSearchPageContext([
		{
			type: "enum",
			target: "type",
			value: "devices",
		},
	]);

	return (
		<PageLayout heading={<PageLayoutHeading>Devices</PageLayoutHeading>}>
			<SearchPage {...ctx} showFilterBar={false} />
		</PageLayout>
	);
}
