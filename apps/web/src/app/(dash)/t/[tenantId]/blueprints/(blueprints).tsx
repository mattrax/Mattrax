import { BreadcrumbItem, Button } from "@mattrax/ui";
import { createTimeAgo } from "@solid-primitives/date";
import { A } from "@solidjs/router";
import { Suspense } from "solid-js";
import { stringSimilarity } from "string-similarity-js";
import type { RouterOutput } from "~/api";
import { useTenantId } from "~/app/(dash)";
import { Page } from "~/components/Page";
import { Table, defineTable } from "~/components/Table";
import { trpc } from "~/lib";

const def = defineTable<RouterOutput["blueprint"]["list"][number]>({
	columns: {
		name: {
			title: "Name",
			size: 2,
			render: (row) => (
				<A href={`./${row.id}`} class="text-black">
					{row.name}
				</A>
			),
		},
		description: {
			title: "Description",
			render: (row) => row.description,
		},
		lastModified: {
			title: "Last Modified",
			render: (row) => {
				const [date] = createTimeAgo(row.lastModified);
				return <p class="text-gray-500">{date()}</p>;
			},
		},
		devices: {
			title: "Devices",
			render: (row) => row.devices,
		},
	},
	bulkActions: {
		delete: () => (
			<Button variant="destructive" size="sm" onClick={() => alert("TODO")}>
				Delete
			</Button>
		),
	},
	search: (t, query) => {
		let score = stringSimilarity(t.name, query);
		if (t.description)
			score = Math.max(score, stringSimilarity(t.description, query));
		return score;
	},
});

export default function () {
	const tenantId = useTenantId();
	const blueprints = trpc.blueprint.list.createQuery(() => ({
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
				<Table def={def} data={blueprints.data?.flat()} />
			</Suspense>
		</Page>
	);
}
