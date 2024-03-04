import { Suspense } from "solid-js";
import {
	createSolidTable,
	getCoreRowModel,
	getPaginationRowModel,
	getSortedRowModel,
	getFilteredRowModel,
	createColumnHelper,
} from "@tanstack/solid-table";
import { As } from "@kobalte/core";
import { A } from "@solidjs/router";
import { RouterOutput } from "~/api/trpc";

import { trpc } from "~/lib";
import { StandardTable } from "~/components/StandardTable";
import { useTenant } from "~/app/(dash)/[tenantSlug]";
import { useZodParams } from "~/lib/useZodParams";
import { z } from "zod";
import { createTimeAgo } from "@solid-primitives/date";

const column =
	createColumnHelper<RouterOutput["policy"]["getVersions"][number]>();

export const columns = [
	column.display({
		id: "number",
		header: "Number",
		cell: ({ row }) => <A href={row.getValue("id") || ""}># {row.index + 1}</A>,
		size: 1,
	}),
	column.accessor("status", {
		header: "Status",
		// TODO: Render as badge
	}),
	// TODO: Show the deploy comment
	// TODO: Created/Deployed by
	// column.accessor("deployedBy", {
	//   header: "Opened by",
	// }),
	column.display({
		id: "updatedAt",
		header: "Updated",
		cell: ({ row }) => {
			const [timeago] = createTimeAgo(
				row.getValue("deployedAt") || row.getValue("createdAt"),
			);
			return <p>{timeago()}</p>;
		},
	}),
];

// TODO: Disable search, filters and sort until all backend metadata has loaded in. Show tooltip so it's clear what's going on.

function createVersionTable() {
	const tenant = useTenant();
	const params = useZodParams({
		policyId: z.string(),
	});
	const policy = trpc.policy.get.useQuery(() => ({
		tenantSlug: tenant().slug,
		policyId: params.policyId,
	}));
	const versions = trpc.policy.getVersions.useQuery(() => ({
		tenantSlug: tenant().slug,
		policyId: params.policyId,
	}));

	const table = createSolidTable({
		get data() {
			return versions.data || [];
		},
		columns,
		// onSortingChange: setSorting,
		// onColumnFiltersChange: setColumnFilters,
		getCoreRowModel: getCoreRowModel(),
		getPaginationRowModel: getPaginationRowModel(),
		getSortedRowModel: getSortedRowModel(),
		getFilteredRowModel: getFilteredRowModel(),
		// onColumnVisibilityChange: setColumnVisibility,
		// onRowSelectionChange: setRowSelection,
		// state: {
		//   sorting,
		//   columnFilters,
		//   columnVisibility,
		//   rowSelection,
		// },
	});

	return { table, policy, versions };
}

export default function Page() {
	const { table } = createVersionTable();

	return (
		<div class="flex flex-col space-y-2">
			<h2 class="text-2xl font-bold mb-4">Versions</h2>
			<Suspense>
				<StandardTable table={table} />
			</Suspense>
		</div>
	);
}
