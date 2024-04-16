import { A, type RouteDefinition } from "@solidjs/router";
import { createColumnHelper } from "@tanstack/solid-table";
import { createTimeAgo } from "@solid-primitives/date";
import type { RouterOutput } from "~/api/trpc";
import { Suspense } from "solid-js";
import { As } from "@kobalte/core";

import IconCarbonCaretDown from "~icons/carbon/caret-down.jsx";
import {
	ColumnsDropdown,
	StandardTable,
	createStandardTable,
	createSearchParamPagination,
	selectCheckboxColumn,
} from "~c/StandardTable";
import { Button, Input } from "@mattrax/ui";
import { trpc } from "~/lib";
import { PageLayout, PageLayoutHeading } from "~c/PageLayout";
import { useZodParams } from "~/lib/useZodParams";
import { z } from "zod";

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

function createDevicesTable() {
	const params = useZodParams({ tenantSlug: z.string() });
	const devices = trpc.device.list.createQuery(() => params);

	const table = createStandardTable({
		get data() {
			return devices.data || [];
		},
		columns,
		pagination: true,
	});

	createSearchParamPagination(table, "page");

	return { devices, table };
}

// TODO: Infinite scroll

// TODO: Disable search, filters and sort until all backend metadata has loaded in. Show tooltip so it's clear what's going on.

export default function Page() {
	// const location = useLocation();
	const { table, devices } = createDevicesTable();

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
				<Input
					class="flex-1"
					placeholder={devices.isLoading ? "Loading..." : "Search..."}
					disabled={devices.isLoading}
					value={(table.getColumn("name")?.getFilterValue() as string) ?? ""}
					onInput={(event) =>
						table.getColumn("name")?.setFilterValue(event.target.value)
					}
				/>
				<ColumnsDropdown table={table}>
					<As component={Button} variant="outline" class="ml-auto select-none">
						Columns
						<IconCarbonCaretDown class="ml-2 h-4 w-4" />
					</As>
				</ColumnsDropdown>
			</div>
			<Suspense>
				<StandardTable table={table} />
			</Suspense>
		</PageLayout>
	);
}
