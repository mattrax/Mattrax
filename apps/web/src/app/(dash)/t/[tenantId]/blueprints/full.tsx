// TODO: Remove this file once testing is done

import { BreadcrumbItem } from "@mattrax/ui";
import { Suspense } from "solid-js";
import { useTenantId } from "~/app/(dash)";
import { Page } from "~/components/Page";
import { Table } from "~/components/Table";
import { trpc } from "~/lib";

export default function () {
	const tenantId = useTenantId();

	const blueprints = trpc.blueprint.list2.createQuery(() => ({
		tenantId: tenantId(),
	}));

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
				<Table data={blueprints.data?.flat() || []} />
			</Suspense>
		</Page>
	);
}
