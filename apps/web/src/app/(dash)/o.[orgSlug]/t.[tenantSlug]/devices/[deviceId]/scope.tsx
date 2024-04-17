import { As } from "@kobalte/core";
import { Suspense } from "solid-js";
import { Button } from "@mattrax/ui";
import pluralize from "pluralize";

import { trpc } from "~/lib";
import { useDevice } from "./Context";
import { PageLayout, PageLayoutHeading } from "~c/PageLayout";
import { StandardTable, createStandardTable } from "~c/StandardTable";
import { VariantTableSheet, variantTableColumns } from "~c/VariantTableSheet";
import { useTenantSlug } from "../../../t.[tenantSlug]";

export default function Page() {
	const tenantSlug = useTenantSlug();
	const device = useDevice();

	const members = trpc.device.members.createQuery(() => ({
		id: device().id,
	}));

	const table = createStandardTable({
		get data() {
			return members.data ?? [];
		},
		columns: variantTableColumns,
		pagination: true,
	});

	const addMembers = trpc.device.addMembers.createMutation(() => ({
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
					<PageLayoutHeading>Scope</PageLayoutHeading>
					<VariantTableSheet
						title="Assign Policy"
						description="Assign this policy to devices, users, or groups."
						getSubmitText={(count) =>
							`Assign ${count} ${pluralize("Policy", count)}`
						}
						variants={variants}
						onSubmit={(members) =>
							addMembers.mutateAsync({
								id: device().id,
								members,
							})
						}
					>
						<As component={Button} class="ml-auto">
							Add Member
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
