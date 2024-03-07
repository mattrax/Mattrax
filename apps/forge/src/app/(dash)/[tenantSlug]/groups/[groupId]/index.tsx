import { createColumnHelper } from "@tanstack/solid-table";
import { Accessor, Suspense, createMemo, createSignal } from "solid-js";
import { Dynamic } from "solid-js/web";
import { toast } from "solid-sonner";
import { As } from "@kobalte/core";
import { z } from "zod";

import { trpc } from "~/lib";
import { PageLayout, PageLayoutHeading } from "../../PageLayout";
import { useGroup } from "../[groupId]";
import { Badge, Button } from "~/components/ui";
import { AddMemberSheet } from "../AddMemberSheet";
import {
	StandardTable,
	createStandardTable,
	selectCheckboxColumn,
} from "~/components/StandardTable";

export default function Page() {
	const group = useGroup();
	const updateGroup = trpc.group.update.useMutation(() => ({
		onSuccess: () => group.query.refetch(),
	}));

	const table = createMembersTable(() => group().id);

	const updateName = (name: string) => {
		if (name === "") {
			toast.error("Group name cannot be empty");
			return;
		}

		toast.promise(
			updateGroup.mutateAsync({
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
	const name = createMemo(() => (editingName() ? cachedName() : group().name));

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
					<AddMemberSheet groupId={group().id}>
						<As component={Button} class="ml-auto">
							Add Members
						</As>
					</AddMemberSheet>
				</>
			}
		>
			<Suspense>
				<StandardTable table={table} />
			</Suspense>
		</PageLayout>
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
	const members = trpc.group.members.useQuery(() => ({
		id: groupId(),
	}));

	return createStandardTable({
		get data() {
			return members.data ?? [];
		},
		columns,
	});
}
