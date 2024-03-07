import { createColumnHelper } from "@tanstack/solid-table";
import { Accessor, Show, Suspense, createMemo, createSignal } from "solid-js";
import { As } from "@kobalte/core";
import { z } from "zod";

import { Badge, Button } from "~/components/ui";
import { trpc } from "~/lib";
import { useZodParams } from "~/lib/useZodParams";
import { AddMemberSheet } from "./AddMemberSheet";
import {
	StandardTable,
	createStandardTable,
	selectCheckboxColumn,
} from "~/components/StandardTable";
import { toast } from "solid-sonner";
import { Dynamic } from "solid-js/web";
import { PageLayout, PageLayoutHeading } from "../PageLayout";
import { useTenant } from "../../TenantContext";
import { Breadcrumb } from "~/components/Breadcrumbs";
import { A } from "@solidjs/router";

export default function Page() {
	const routeParams = useZodParams({ groupId: z.string() });

	const tenant = useTenant();
	const group = trpc.group.get.useQuery(() => ({
		id: routeParams.groupId,
		tenantSlug: tenant().slug,
	}));

	const updateGroup = trpc.group.update.useMutation(() => ({
		onSuccess: () => group.refetch(),
	}));

	return (
		<Show when={group.data}>
			{(group) => {
				const table = createMembersTable(() => group().id);

				const updateName = (name: string) => {
					if (name === "") {
						toast.error("Group name cannot be empty");
						return;
					}

					toast.promise(
						updateGroup.mutateAsync({
							tenantSlug: tenant().slug,
							id: group().id,
							name,
						}),
						{
							loading: "Updating group name...",
							success: "Group name updated",
							error: "Failed to update group name",
						},
					);
				};

				const [editingName, setEditingName] = createSignal(false);

				let nameEl: HTMLHeadingElement;

				const [cachedName, setCachedName] = createSignal(group().name);
				const name = createMemo(() =>
					editingName() ? cachedName() : group().name,
				);

				return (
					<PageLayout
						heading={
							<>
								<PageLayoutHeading
									ref={nameEl!}
									class="p-2 -m-2"
									contenteditable={editingName()}
									onKeyDown={(e) => {
										if (e.key === "Enter") {
											e.preventDefault();
											e.currentTarget.blur();
										} else if (e.key === "Escape") {
											e.preventDefault();
											setEditingName(false);
										}
									}}
								>
									{name()}
								</PageLayoutHeading>
								<Button
									variant="link"
									size="iconSmall"
									class="text-lg"
									onClick={() => {
										setEditingName((e) => !e);

										if (editingName()) {
											setCachedName(group().name);

											nameEl.focus();
										} else {
											updateName(nameEl.textContent ?? "");
										}
									}}
								>
									<Dynamic
										component={
											editingName()
												? IconIcRoundCheck
												: IconMaterialSymbolsEditOutline
										}
									/>
								</Button>
								<AddMemberSheet groupId={routeParams.groupId}>
									<As component={Button} class="ml-auto">
										Add Members
									</As>
								</AddMemberSheet>
							</>
						}
					>
						<Breadcrumb>
							<A href="" class="flex flex-row items-center gap-2">
								<span>{group().name}</span>
								<Badge variant="outline">Group</Badge>
							</A>
						</Breadcrumb>
						<Suspense>
							<StandardTable table={table} />
						</Suspense>
					</PageLayout>
				);
			}}
		</Show>
	);
}

const VariantDisplay = {
	user: "User",
	device: "Device",
} as const;

type Variant = keyof typeof VariantDisplay;

const columnHelper = createColumnHelper<{
	pk: number;
	name: string;
	variant: Variant;
}>();

export const columns = [
	selectCheckboxColumn,
	columnHelper.accessor("name", { header: "Name" }),
	columnHelper.accessor("variant", {
		header: "Variant",
		cell: (info) => <Badge>{VariantDisplay[info.getValue()]}</Badge>,
	}),
];

function createMembersTable(groupId: Accessor<string>) {
	const tenant = useTenant();
	const members = trpc.group.members.useQuery(() => ({
		id: groupId(),
		tenantSlug: tenant().slug,
	}));

	return createStandardTable({
		get data() {
			return members.data ?? [];
		},
		columns,
	});
}
