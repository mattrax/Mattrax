import { Suspense, createMemo, createSignal } from "solid-js";
import { RouteDefinition } from "@solidjs/router";
import { Dynamic } from "solid-js/web";
import { toast } from "solid-sonner";
import { Button, Label } from "@mattrax/ui";
import { As } from "@kobalte/core";
import pluralize from "pluralize";

import IconMaterialSymbolsEditOutline from "~icons/material-symbols/edit-outline.jsx";
import IconIcRoundCheck from "~icons/ic/round-check.jsx";
import { VariantTableSheet, variantTableColumns } from "~c/VariantTableSheet";
import { StandardTable, createStandardTable } from "~c/StandardTable";
import { PageLayout, PageLayoutHeading } from "~c/PageLayout";
import { useTenantSlug } from "../../../t.[tenantSlug]";
import { useGroup } from "./Context";
import { trpc } from "~/lib";

export const route = {
	load: ({ params }) => {
		trpc.useContext().group.members.ensureData({
			id: params.groupId!,
		});
		trpc.useContext().group.assignments.ensureData({
			id: params.groupId!,
		});
	},
} satisfies RouteDefinition;

export default function Page() {
	return (
		<PageLayout
			heading={
				<>
					<NameEditor />
					{/* TODO: This show show policies */}
				</>
			}
		>
			<div class="flex flex-row gap-8">
				<div class="flex-1 space-y-4">
					<Members />
				</div>
				<div class="flex-1 space-y-4">
					<Assignments />
				</div>
			</div>
		</PageLayout>
	);
}

function NameEditor() {
	const group = useGroup();

	const updateGroup = trpc.group.update.createMutation(() => ({
		onSuccess: () => group.query.refetch(),
	}));

	const updateName = (name: string) => {
		if (name === "") {
			toast.error("Group name cannot be empty");
			return;
		}

		toast.promise(updateGroup.mutateAsync({ id: group().id, name }), {
			loading: "Updating group name...",
			success: "Group name updated",
			error: "Failed to update group name",
		});
	};

	const [editingName, setEditingName] = createSignal(false);
	let nameEl: HTMLHeadingElement;

	const [cachedName, setCachedName] = createSignal(group().name);
	const name = createMemo(() => (editingName() ? cachedName() : group().name));

	return (
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
						editingName() ? IconIcRoundCheck : IconMaterialSymbolsEditOutline
					}
				/>
			</Button>
		</>
	);
}

function Members() {
	const tenantSlug = useTenantSlug();
	const group = useGroup();

	const members = trpc.group.members.createQuery(() => ({
		id: group().id,
	}));

	const membersTable = createStandardTable({
		get data() {
			return members.data ?? [];
		},
		columns: variantTableColumns,
		// pagination: true, // TODO: Pagination
	});

	const addMembers = trpc.group.addMembers.createMutation(() => ({
		onSuccess: () => members.refetch(),
	}));

	const variants = {
		user: {
			label: "Users",
			query: trpc.tenant.variantTable.users.createQuery(() => ({
				tenantSlug: tenantSlug(),
			})),
		},
		device: {
			label: "Devices",
			query: trpc.tenant.variantTable.devices.createQuery(() => ({
				tenantSlug: tenantSlug(),
			})),
		},
	};

	return (
		<>
			<div class="flex flex-row items-center justify-between">
				<Label>Members</Label>
				<VariantTableSheet
					title="Add Members"
					description="Add users and devices to this group."
					getSubmitText={(count) =>
						`Add ${count} ${pluralize("Member", count)}`
					}
					variants={variants}
					onSubmit={(members) =>
						addMembers.mutateAsync({
							id: group().id,
							members,
						})
					}
				>
					<As component={Button} class="ml-auto" size="sm">
						Add Members
					</As>
				</VariantTableSheet>
			</div>
			<Suspense>
				<StandardTable table={membersTable} />
			</Suspense>
		</>
	);
}

function Assignments() {
	const tenantSlug = useTenantSlug();
	const group = useGroup();

	const assignments = trpc.group.assignments.createQuery(() => ({
		id: group().id,
	}));

	const table = createStandardTable({
		get data() {
			return assignments.data ?? [];
		},
		columns: variantTableColumns,
		// pagination: true, // TODO: Pagination
	});

	const addAssignments = trpc.group.addAssignments.createMutation(() => ({
		onSuccess: () => assignments.refetch(),
	}));

	const variants = {
		policy: {
			label: "Policies",
			query: trpc.tenant.variantTable.policies.createQuery(() => ({
				tenantSlug: tenantSlug(),
			})),
		},
		app: {
			label: "Applications",
			query: trpc.tenant.variantTable.apps.createQuery(() => ({
				tenantSlug: tenantSlug(),
			})),
		},
	};

	return (
		<>
			<div class="flex flex-row items-center justify-between">
				<Label>Assignments</Label>
				<VariantTableSheet
					title="Add Assigments"
					description="Assign policies and apps to this group."
					getSubmitText={(count) =>
						`Add ${count} ${pluralize("Assignment", count)}`
					}
					variants={variants}
					onSubmit={(assignments) =>
						addAssignments.mutateAsync({
							id: group().id,
							assignments,
						})
					}
				>
					<As component={Button} class="ml-auto" size="sm">
						Add Assignments
					</As>
				</VariantTableSheet>
			</div>
			<Suspense>
				<StandardTable table={table} />
			</Suspense>
		</>
	);
}
