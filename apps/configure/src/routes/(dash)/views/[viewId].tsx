import { Show } from "solid-js";
import { z } from "zod";
import { PageLayout, PageLayoutHeading } from "~/components/PageLayout";
import { SearchPage, createSearchPageContext } from "~/components/search";
import { createDbQuery } from "~/lib/query";
import { useZodParams } from "~/lib/useZodParams";

export default function Page() {
	// TODO: Showing warning when changing filters
	// TODO: Allow saving changes back to view
	// TODO: Disable save button unless changes from `createSearchPageContext`'s default.

	const params = useZodParams({ viewId: z.string() });

	// TODO: if the view is modified in another tab we are gonna wipe out any changes which is not great.
	const views = createDbQuery((db) => db.getAll("views")); // TODO: Filter to a specific view using IndexedDB query here???

	// TODO: Loading state!
	return (
		<Show when={views()}>
			{(views) => {
				const view = views().find((v) => v.id === params.viewId);
				if (!view) {
					return <div>View not found</div>;
				}

				const ctx = createSearchPageContext(view.data);
				return (
					<PageLayout
						heading={<PageLayoutHeading>{view.name}</PageLayoutHeading>}
					>
						<SearchPage {...ctx} />
					</PageLayout>
				);
			}}
		</Show>
	);
}
