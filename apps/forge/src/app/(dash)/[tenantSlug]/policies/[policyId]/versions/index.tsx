// import { Suspense } from "solid-js";
// import {
// 	createSolidTable,
// 	getCoreRowModel,
// 	getPaginationRowModel,
// 	getSortedRowModel,
// 	getFilteredRowModel,
// 	createColumnHelper,
// } from "@tanstack/solid-table";
// import { A } from "@solidjs/router";
// import { RouterOutput } from "~/api/trpc";

import { PageLayout, PageLayoutHeading } from "../../../PageLayout";

// import { trpc } from "~/lib";
// import {
// 	StandardTable,
// 	createSearchParamPagination,
// 	createStandardTable,
// } from "~/components/StandardTable";
// import { useZodParams } from "~/lib/useZodParams";
// import { z } from "zod";
// import { createTimeAgo } from "@solid-primitives/date";
// import { PageLayout, PageLayoutHeading } from "../../../PageLayout";

// const column =
// 	createColumnHelper<RouterOutput["policy"]["getVersions"][number]>();

// export const columns = [
// 	column.display({
// 		id: "number",
// 		header: "Number",
// 		cell: ({ row }) => <A href={row.original.id}># {row.index + 1}</A>,
// 		size: 1,
// 	}),
// 	column.accessor("status", {
// 		header: "Status",
// 		// TODO: Render as badge
// 	}),
// 	// TODO: Show the deploy comment
// 	// TODO: Created/Deployed by
// 	// column.accessor("deployedBy", {
// 	//   header: "Opened by",
// 	// }),
// 	column.display({
// 		id: "updatedAt",
// 		header: "Updated",
// 		cell: ({ row }) => {
// 			const [timeago] = createTimeAgo(
// 				row.getValue("deployedAt") || row.getValue("createdAt"),
// 			);
// 			return <p>{timeago()}</p>;
// 		},
// 	}),
// ];

// // TODO: Disable search, filters and sort until all backend metadata has loaded in. Show tooltip so it's clear what's going on.

// function createVersionTable() {
// 	const params = useZodParams({ tenantSlug: z.string() });
// 	const params = useZodParams({
// 		policyId: z.string(),
// 	});
// 	const policy = trpc.policy.get.useQuery(() => ({
// 		tenantSlug: tenant().slug,
// 		policyId: params.policyId,
// 	}));
// 	const versions = trpc.policy.getVersions.useQuery(() => ({
// 		tenantSlug: tenant().slug,
// 		policyId: params.policyId,
// 	}));

// 	const table = createStandardTable({
// 		get data() {
// 			return versions.data || [];
// 		},
// 		columns,
// 		pagination: true,
// 	});

// 	createSearchParamPagination(table, "page");

// 	return { table, policy, versions };
// }

// export default function Page() {
// 	const { table } = createVersionTable();

// 	return (
// 		<PageLayout heading={<PageLayoutHeading>Versions</PageLayoutHeading>}>
// 			<StandardTable table={table} />
// 		</PageLayout>
// 	);
// }

export default function Page() {
	return (
		<PageLayout heading={<PageLayoutHeading>History</PageLayoutHeading>}>
			<h1>TODO</h1>
		</PageLayout>
	);
}
