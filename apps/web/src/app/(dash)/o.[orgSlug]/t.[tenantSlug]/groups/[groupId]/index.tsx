import { Button, Input, Label } from "@mattrax/ui";
import { A, type RouteDefinition } from "@solidjs/router";
import { Suspense, createMemo, createSignal } from "solid-js";
import { Dynamic } from "solid-js/web";
import { toast } from "solid-sonner";

import { withDependantQueries } from "@mattrax/trpc-server-function/client";
import { StatItem } from "~/components/StatItem";
import { trpc } from "~/lib";
import { PageLayout, PageLayoutHeading } from "~c/PageLayout";
import { StandardTable, createStandardTable } from "~c/StandardTable";
import { createVariantTableColumns } from "~c/VariantTableSheet";

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

import { cacheMetadata, getMetadata } from "../../metadataCache";
import { useGroup, useGroupId } from "../ctx";
import { createAssignmentsVariants, createMembersVariants } from "./utils";

export default function Page() {
	return (
		<PageLayout
			heading={
				<>
					<Suspense
						fallback={
							<span class="relative">
								<PageLayoutHeading class="opacity-0">
									Loading...
								</PageLayoutHeading>
								<div class="w-full bg-neutral-200 animate-pulse absolute inset-y-0 rounded-full" />
							</span>
						}
					>
						<NameEditor />
					</Suspense>
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
	const groupId = useGroupId();
	const group = useGroup();
	cacheMetadata("group", () => (group.data ? [group.data] : []));

	const updateGroup = trpc.group.update.createMutation(() => ({
		...withDependantQueries(group),
	}));

	const updateName = (name: string) => {
		if (name === "") {
			toast.error("Group name cannot be empty");
			return;
		}

		toast.promise(updateGroup.mutateAsync({ id: groupId(), name }), {
			loading: "Updating group name...",
			success: "Group name updated",
			error: "Failed to update group name",
		});
	};

	const [editingName, setEditingName] = createSignal(false);
	let nameEl: HTMLHeadingElement;

	const getName = () =>
		getMetadata("group", groupId())?.name ?? group.data?.name;

	const [cachedName, setCachedName] = createSignal(getName());

	const nameText = createMemo(() => (editingName() ? cachedName() : getName()));

	return (
		<>
			<PageLayoutHeading
				class="p-2 -m-2 relative"
				ref={nameEl!}
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
				{nameText()}
			</PageLayoutHeading>
			<Button
				variant="link"
				size="iconSmall"
				class="text-lg"
				onClick={() => {
					setEditingName((e) => !e);

					if (editingName()) {
						setCachedName(getName());

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
	const groupId = useGroupId();

	const members = trpc.group.members.createQuery(() => ({
		id: groupId(),
	}));

	const variants = createMembersVariants("../../");

	const membersTable = createStandardTable({
		get data() {
			return members.data ?? [];
		},
		columns: createVariantTableColumns().slice(1),
	});

	return (
		<>
			<div class="grid grid-cols-2 gap-4">
				<StatItem
					title="Users"
					href="members?variant=user"
					icon={<IconPhUser />}
					value={members.data?.filter((m) => m.variant === "user").length}
				/>
				<StatItem
					title="Devices"
					href="members?variant=device"
					icon={<IconPhDevices />}
					value={members.data?.filter((m) => m.variant === "device").length}
				/>
			</div>
			<div class="flex flex-row items-center justify-between">
				<Label class="flex-1">
					<A href="members" class="hover:underline w-full block">
						Members
					</A>
				</Label>
				<Input class="max-w-72" placeholder="Search members" disabled />
				{/* <VariantTableSheet
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
        </VariantTableSheet> */}
			</div>
			<Suspense>
				<StandardTable table={membersTable} />
			</Suspense>
		</>
	);
}

function Assignments() {
	const groupId = useGroupId();

	const assignments = trpc.group.assignments.createQuery(() => ({
		id: groupId(),
	}));

	const variants = createAssignmentsVariants("../../");

	const table = createStandardTable({
		get data() {
			return assignments.data ?? [];
		},
		columns: createVariantTableColumns().slice(1),
	});

	return (
		<>
			<div class="grid grid-cols-2 gap-4">
				<StatItem
					title="Policies"
					href="assignments?variant=policy"
					icon={<IconPhUser />}
					value={assignments.data?.filter((a) => a.variant === "policy").length}
				/>
				<StatItem
					title="Apps"
					href="assignments?variant=app"
					icon={<IconPhDevices />}
					value={
						assignments.data?.filter((a) => a.variant === "application").length
					}
				/>
			</div>
			<div class="flex flex-row items-center justify-between">
				<Label class="flex-1">
					<A href="assignments" class="hover:underline w-full block">
						Assignments
					</A>
				</Label>
				<Input class="max-w-72" placeholder="Search assignments" disabled />
			</div>
			<Suspense>
				<StandardTable table={table} />
			</Suspense>
		</>
	);
}
