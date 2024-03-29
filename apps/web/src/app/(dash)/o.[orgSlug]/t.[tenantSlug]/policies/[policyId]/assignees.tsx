import { As } from "@kobalte/core";
import { Suspense } from "solid-js";

import { Button } from "@mattrax/ui";
import { trpc } from "~/lib";
import { usePolicy } from "./Context";
import { PageLayout, PageLayoutHeading } from "~c/PageLayout";
import { StandardTable, createStandardTable } from "~c/StandardTable";
import {
	AddMemberSheet,
	memberSheetColumns,
} from "~[tenantSlug]/AddMemberSheet";

export default function Page() {
	const policy = usePolicy();

	const members = trpc.policy.members.useQuery(() => ({
		id: policy().id,
	}));

	const table = createStandardTable({
		get data() {
			return members.data ?? [];
		},
		columns: memberSheetColumns,
		pagination: true,
	});

	const addMembers = trpc.policy.addMembers.useMutation(() => ({
		onSuccess: () => members.refetch(),
	}));

	return (
		<PageLayout
			heading={
				<>
					<PageLayoutHeading>Scope</PageLayoutHeading>
					<AddMemberSheet
						// @ts-expect-error // TODO
						addMember={(members) =>
							addMembers.mutateAsync({
								id: policy().id,
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
