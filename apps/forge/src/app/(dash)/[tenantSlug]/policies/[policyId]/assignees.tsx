import { As } from "@kobalte/core";
import { Suspense } from "solid-js";

import { Button } from "~/components/ui";
import { trpc } from "~/lib";
import { usePolicy } from "../[policyId]";
import { PageLayout, PageLayoutHeading } from "../../PageLayout";
import {
	AddMemberSheet,
	memberSheetColumns,
} from "~/components/AddMemberSheet";
import { StandardTable, createStandardTable } from "~/components/StandardTable";

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
