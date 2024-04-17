import { As } from "@kobalte/core";
import { Suspense } from "solid-js";
import { Button } from "@mattrax/ui";
import pluralize from "pluralize";

import { trpc } from "~/lib";
import { usePolicy } from "./Context";
import { PageLayout, PageLayoutHeading } from "~c/PageLayout";
import { StandardTable, createStandardTable } from "~c/StandardTable";
import { VariantTableSheet, variantTableColumns } from "~c/VariantTableSheet";
import { useTenantSlug } from "../../../t.[tenantSlug]";

export default function Page() {
	const policy = usePolicy();
	const tenantSlug = useTenantSlug();

	const members = trpc.policy.members.createQuery(() => ({
		id: policy().id,
	}));

	const table = createStandardTable({
		get data() {
			return members.data ?? [];
		},
		columns: variantTableColumns,
		pagination: true,
	});

	const addMembers = trpc.policy.addMembers.createMutation(() => ({
		onSuccess: () => members.refetch(),
	}));

	const variants = {
		device: {
			label: "Devices",
			query: trpc.tenant.variantTable.devices.createQuery(() => ({
				tenantSlug: tenantSlug(),
			})),
		},
		user: {
			label: "Users",
			query: trpc.tenant.variantTable.users.createQuery(() => ({
				tenantSlug: tenantSlug(),
			})),
		},
		group: {
			label: "Groups",
			query: trpc.tenant.variantTable.groups.createQuery(() => ({
				tenantSlug: tenantSlug(),
			})),
		},
	};

	return (
		<PageLayout
			heading={
				<>
					<PageLayoutHeading>Assignees</PageLayoutHeading>
					<VariantTableSheet
						title="Assign Policy"
						description="Assign this policy to devices, users, and groups."
						getSubmitText={(count) =>
							`Add ${count} ${pluralize("Assignee", count)}`
						}
						variants={variants}
						onSubmit={(members) =>
							addMembers.mutateAsync({
								id: policy().id,
								members,
							})
						}
					>
						<As component={Button} class="ml-auto">
							Assign Policy
						</As>
					</VariantTableSheet>
				</>
			}
		>
			<Suspense>
				<StandardTable table={table} />
			</Suspense>
		</PageLayout>
	);
}
