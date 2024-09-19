import { BreadcrumbItem } from "@mattrax/ui";
import { Suspense } from "solid-js";
import { useTenantId } from "~/app/(dash)";
import { Page } from "~/components/Page";
import { Table } from "~/components/Table";
import { trpc } from "~/lib";
import {
	createCollectedGenerator,
	refetchWhenStale,
} from "~/lib/createCollectedGenerator";

export default function () {
	const tenantId = useTenantId();
	const ctx = trpc.useContext();

	const blueprints = createCollectedGenerator((signal) =>
		ctx.blueprint.list.fetch(
			{
				tenantId: tenantId(),
			},
			{
				queryKey: [
					["blueprint", "list"],
					{
						tenantId: tenantId(),
					},
				],
				signal,
			},
		),
	);
	refetchWhenStale(blueprints);

	return (
		<Page
			title="Blueprints"
			breadcrumbs={[
				<BreadcrumbItem>
					<BreadcrumbItem>Blueprints</BreadcrumbItem>
				</BreadcrumbItem>,
			]}
		>
			<Suspense fallback={<p>TODO: Loading...</p>}>
				{/* <p>{blueprints.loading.toString()}</p> */}
				<Table data={blueprints.data.flat() || []} />
			</Suspense>
		</Page>
	);
}
