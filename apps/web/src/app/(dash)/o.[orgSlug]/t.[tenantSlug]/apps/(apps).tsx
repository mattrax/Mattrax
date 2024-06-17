import { withDependantQueries } from "@mattrax/trpc-server-function/client";
import { Button, DropdownMenuTrigger } from "@mattrax/ui";
import { A, type RouteDefinition } from "@solidjs/router";
import { createColumnHelper } from "@tanstack/solid-table";

import pluralize from "pluralize";
import { Match, Suspense, Switch } from "solid-js";
import {
	BulkDeleteDialog,
	createBulkDeleteDialog,
} from "~/components/BulkDeleteDialog";
import { trpc } from "~/lib";
import { PageLayout, PageLayoutHeading } from "~c/PageLayout";
import {
	FloatingSelectionBar,
	StandardTable,
	createSearchParamFilter,
	createStandardTable,
	selectCheckboxColumn,
} from "~c/StandardTable";
import { TableSearchParamsInput } from "~c/TableSearchParamsInput";
import { useTenantSlug } from "../ctx";
import { cacheMetadata } from "../metadataCache";
import { CreateApplicationSheet } from "./CreateApplicationSheet";

export const route = {
	load: ({ params }) => {
		trpc.useContext().user.list.ensureData({
			tenantSlug: params.tenantSlug!,
		});
	},
} satisfies RouteDefinition;

const column = createColumnHelper<{ id: string; name: string }>();

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
	// TODO: Descriptions, supported OS's.
];

export default function Page() {
	const tenantSlug = useTenantSlug();

	const apps = trpc.app.list.createQuery(() => ({ tenantSlug: tenantSlug() }));
	cacheMetadata("application", () => apps.data ?? []);

	const table = createStandardTable({
		get data() {
			return apps.data ?? [];
		},
		columns,
	});

	createSearchParamFilter(table, "name", "search");

	const deleteGroups = trpc.app.delete.createMutation(() => ({
		...withDependantQueries(apps),
	}));

	const dialog = createBulkDeleteDialog({
		table,
		onDelete: (data) =>
			deleteGroups.mutateAsync({
				tenantSlug: tenantSlug(),
				ids: data.map(({ id }) => id),
			}),
	});

	return (
		<PageLayout
			heading={
				<>
					<PageLayoutHeading>Applications</PageLayoutHeading>
					<CreateApplicationSheet>
						{(props) => (
							<Button class="ml-auto" {...props}>
								Create Application
							</Button>
						)}
					</CreateApplicationSheet>
				</>
			}
		>
			<div class="flex flex-row items-center gap-4">
				<TableSearchParamsInput query={apps} />
			</div>
			<Suspense>
				<StandardTable table={table} />
				<BulkDeleteDialog
					dialog={dialog}
					title={({ count }) => <>Delete {pluralize("Device", count())}</>}
					description={({ count, rows }) => (
						<>
							Are you sure you want to delete{" "}
							<Switch>
								<Match when={count() > 1}>
									{count()} {pluralize("device", count())}
								</Match>
								<Match when={rows()[0]}>
									{(data) => (
										<div class="inline text-nowrap">
											<span class="text-black font-medium">
												{data().original.name}
											</span>
										</div>
									)}
								</Match>
							</Switch>
							?
						</>
					)}
				/>
				<FloatingSelectionBar table={table}>
					{(rows) => (
						<Button
							variant="destructive"
							size="sm"
							onClick={() => dialog.show(rows())}
						>
							Delete
						</Button>
					)}
				</FloatingSelectionBar>
			</Suspense>
		</PageLayout>
	);
}
