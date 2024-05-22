import { createTimeAgo } from "@solid-primitives/date";
import { A, type RouteDefinition } from "@solidjs/router";
import { createColumnHelper } from "@tanstack/solid-table";
import { Suspense } from "solid-js";
import type { RouterOutput } from "~/api/trpc";

import { Button, DropdownMenuTrigger } from "@mattrax/ui";
import { z } from "zod";
import { TableSearchParamsInput } from "~/components/TableSearchParamsInput";
import { trpc } from "~/lib";
import { useZodParams } from "~/lib/useZodParams";
import { PageLayout, PageLayoutHeading } from "~c/PageLayout";
import {
	ColumnsDropdown,
	StandardTable,
	createSearchParamFilter,
	createSearchParamPagination,
	createStandardTable,
	selectCheckboxColumn,
} from "~c/StandardTable";
import IconCarbonCaretDown from "~icons/carbon/caret-down.jsx";
import { cacheMetadata } from "../metadataCache";

export const route = {
	load: ({ params }) => {
		trpc.useContext().device.list.ensureData({
			tenantSlug: params.tenantSlug!,
		});
	},
} satisfies RouteDefinition;

const column = createColumnHelper<RouterOutput["device"]["list"][number]>();

const columns = [
	selectCheckboxColumn,
	column.accessor("name", {
		header: "Name",
		cell: (props) => (
			<A
				class="font-medium hover:underline focus:underline p-1 -m-1 w-full block"
				href={props.row.original.id}
			>
				{props.getValue()}
			</A>
		),
	}),
	column.accessor("os", { header: "Operating System" }),
	column.accessor("serialNumber", { header: "Serial Number" }),
	column.accessor("owner", {
		header: "Owner",
		// TODO: Render as link with the user's name
	}),
	column.accessor("lastSynced", {
		header: "Last Synced",
		cell: (cell) => {
			const [timeago] = createTimeAgo(cell.getValue());
			return <p>{timeago()}</p>;
		},
	}),
	column.accessor("enrolledAt", {
		header: "Enrolled At",
		cell: (cell) => {
			const [timeago] = createTimeAgo(cell.getValue());
			return <p>{timeago()}</p>;
		},
	}),
];

// TODO: Infinite scroll

// TODO: Disable search, filters and sort until all backend metadata has loaded in. Show tooltip so it's clear what's going on.

export default function Page() {
	// const location = useLocation();
	const params = useZodParams({ tenantSlug: z.string() });
	const devices = trpc.device.list.createQuery(() => params);
	cacheMetadata("device", () => devices.data ?? []);

	const table = createStandardTable({
		get data() {
			return devices.data || [];
		},
		columns,
		pagination: true,
	});

	createSearchParamPagination(table, "page");
	createSearchParamFilter(table, "name", "search");

	return (
		<PageLayout
			heading={
				<>
					<PageLayoutHeading>Devices</PageLayoutHeading>
					{/* // TODO: Put this somewhere but make it logical and right here is not it */}
					{/* <Button
		      onClick={() =>
		        navigate("/enroll", {
		          state: {
		            backUrl: location.pathname,
		          },
		        })
		      }
		    >
		      Enroll Device
		    </Button> */}
				</>
			}
		>
			<div class="flex flex-row items-center gap-4">
				<TableSearchParamsInput class="flex-1" query={devices} />
				<ColumnsDropdown table={table}>
					<DropdownMenuTrigger
						as={Button}
						variant="outline"
						class="ml-auto select-none"
					>
						Columns
						<IconCarbonCaretDown class="ml-2 h-4 w-4" />
					</DropdownMenuTrigger>
				</ColumnsDropdown>
			</div>
			<Suspense>
				<StandardTable table={table} />
			</Suspense>
		</PageLayout>
	);
}
