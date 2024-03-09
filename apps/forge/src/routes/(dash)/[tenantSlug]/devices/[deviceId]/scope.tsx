import { As } from "@kobalte/core";
import { Suspense } from "solid-js";

import { Button } from "~/components/ui";
import { trpc } from "~/lib";
import { useDevice } from "./Context";
import { PageLayout, PageLayoutHeading } from "../../PageLayout";
import {
	AddMemberSheet,
	memberSheetColumns,
} from "~/components/AddMemberSheet";
import { StandardTable, createStandardTable } from "~/components/StandardTable";

export default function Page() {
	const device = useDevice();

	const members = trpc.device.members.useQuery(() => ({
		id: device().id,
	}));

	const table = createStandardTable({
		get data() {
			return members.data ?? [];
		},
		columns: memberSheetColumns,
		pagination: true,
	});

	const addMembers = trpc.device.addMembers.useMutation(() => ({
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
								id: device().id,
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
