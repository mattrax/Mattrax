import { As } from "@kobalte/core";
import { Suspense, createMemo, createSignal } from "solid-js";
import { Dynamic } from "solid-js/web";
import { toast } from "solid-sonner";

import IconMaterialSymbolsEditOutline from '~icons/material-symbols/edit-outline.jsx'
import IconIcRoundCheck from '~icons/ic/round-check.jsx'
import { Button } from "~/components/ui";
import { trpc } from "~/lib";
import { PageLayout, PageLayoutHeading } from "../../PageLayout";
import {
	AddMemberSheet,
	memberSheetColumns,
} from "~/components/AddMemberSheet";
import { StandardTable, createStandardTable } from "~/components/StandardTable";
import { useGroup } from "./Context";

export default function Page() {
	const group = useGroup();
	const updateGroup = trpc.group.update.useMutation(() => ({
		onSuccess: () => group.query.refetch(),
	}));

	const members = trpc.group.members.useQuery(() => ({
		id: group().id,
	}));

	const table = createStandardTable({
		get data() {
			return members.data ?? [];
		},
		columns: memberSheetColumns,
		// pagination: true, // TODO: Pagination
	});

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

	const addMembers = trpc.group.addMembers.useMutation(() => ({
		onSuccess: () => members.refetch(),
	}));

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
					<AddMemberSheet
						omitGroups
						addMember={(members) =>
							addMembers.mutateAsync({
								id: group().id,
								members,
							})
						}
					>
						<As component={Button} class="ml-auto">
							Add Member
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
