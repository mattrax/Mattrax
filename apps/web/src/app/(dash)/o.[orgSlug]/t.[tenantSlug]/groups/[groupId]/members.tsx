import { withDependantQueries } from "@mattrax/trpc-server-function/client";
import { Badge, Button, SheetTrigger } from "@mattrax/ui";
import type { RouteDefinition } from "@solidjs/router";
import pluralize from "pluralize";
import { Match, Suspense, Switch } from "solid-js";

import { BulkDeleteDialog } from "~/components/BulkDeleteDialog";
import { createBulkDeleteDialog } from "~/components/BulkDeleteDialog";
import { trpc } from "~/lib";
import { toTitleCase } from "~/lib/utils";
import { PageLayout, PageLayoutHeading } from "~c/PageLayout";
import {
	FloatingSelectionBar,
	StandardTable,
	createSearchParamFilter,
	createStandardTable,
} from "~c/StandardTable";
import { TableSearchParamsInput } from "~c/TableSearchParamsInput";
import {
	VariantTableSheet,
	createVariantTableColumns,
} from "~c/VariantTableSheet";
import { cacheMetadata } from "../../metadataCache";
import { useGroupId } from "../ctx";
import { createMembersVariants } from "./utils";

export const route = {
	load: ({ params }) =>
		trpc.useContext().group.members.ensureData({
			id: params.groupId!,
		}),
} satisfies RouteDefinition;

function createMembersQuery() {
	const groupId = useGroupId();

	const members = trpc.group.members.createQuery(() => ({ id: groupId() }));

	const cacheMembersWithVariant = (v: "user" | "device") =>
		cacheMetadata(v, () => members.data?.filter((a) => a.variant === v) ?? []);

	cacheMembersWithVariant("user");
	cacheMembersWithVariant("device");

	return members;
}

export default function Page() {
	const groupId = useGroupId();

	const members = createMembersQuery();

	const variants = createMembersVariants("../../../");

	const table = createStandardTable({
		get data() {
			return members.data ?? [];
		},
		columns: createVariantTableColumns(),
	});

	createSearchParamFilter(table, "name", "search");

	const addMembers = trpc.group.addMembers.createMutation(() => ({
		...withDependantQueries(members),
	}));

	const removeMembers = trpc.group.removeMembers.createMutation(() => ({
		// TODO: `withDependantQueries`
		onSuccess: () => members.refetch(),
	}));

	const dialog = createBulkDeleteDialog({
		table,
		onDelete: (data) =>
			removeMembers.mutateAsync({
				id: groupId(),
				members: data.map(({ pk, variant }) => ({
					pk,
					variant: variant as any,
				})),
			}),
	});

	return (
		<PageLayout
			heading={
				<>
					<PageLayoutHeading>Members</PageLayoutHeading>
					<VariantTableSheet
						title="Add Members"
						description="Add users and devices to this group."
						getSubmitText={(count) =>
							`Add ${count} ${pluralize("Member", count)}`
						}
						variants={variants}
						onSubmit={(members) =>
							addMembers.mutateAsync({ id: groupId(), members })
						}
					>
						<SheetTrigger as={Button} class="ml-auto">
							Add Members
						</SheetTrigger>
					</VariantTableSheet>
				</>
			}
		>
			<div class="flex flex-row items-center gap-4">
				<TableSearchParamsInput query={members} class="flex-1" />
			</div>
			<Suspense>
				<StandardTable table={table} />
				<FloatingSelectionBar table={table}>
					{(rows) => (
						<Button
							variant="destructive"
							size="sm"
							onClick={() => dialog.show(rows())}
						>
							Remove from Group
						</Button>
					)}
				</FloatingSelectionBar>
				<BulkDeleteDialog
					dialog={dialog}
					title={() => "Remove From Group"}
					description={({ count, rows }) => (
						<>
							Are you sure you want to remove{" "}
							<Switch>
								<Match when={count() > 1}>
									{count()} {pluralize("member", count())}
								</Match>
								<Match when={rows()[0]}>
									{(data) => (
										<div class="inline text-nowrap">
											<span class="text-black font-medium">
												{data().original.name}
											</span>
											<Badge class="mx-1.5">
												{toTitleCase(data().original.variant)}
											</Badge>
										</div>
									)}
								</Match>
							</Switch>{" "}
							from this group?
						</>
					)}
				/>
			</Suspense>
		</PageLayout>
	);
}
