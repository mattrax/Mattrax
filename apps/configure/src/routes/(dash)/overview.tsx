import { Button } from "@mattrax/ui";
import { PageLayout, PageLayoutHeading } from "~/components/PageLayout";
import { StatItem } from "~/components/StatItem";
import { db } from "~/lib/db";
import { createDbQuery } from "~/lib/query";

export default function Page() {
	const counts = createDbQuery(async () => {
		return {
			users: await (await db).count("users"),
			devices: await (await db).count("devices"),
			groups: await (await db).count("groups"),
			policies: await (await db).count("policies"),
			applications: await (await db).count("apps"),
		};
	});

	return (
		<PageLayout heading={<PageLayoutHeading>Overview</PageLayoutHeading>}>
			<div class="grid gap-4 grid-cols-5">
				<StatItem
					title="Users"
					href="users"
					icon={<IconPhUser />}
					value={counts()?.users || 0}
				/>
				<StatItem
					title="Devices"
					href="devices"
					icon={<IconPhDevices />}
					value={counts()?.devices || 0}
				/>
				<StatItem
					title="Policies"
					href="policies"
					icon={<IconPhScroll />}
					value={counts()?.policies || 0}
				/>
				<StatItem
					title="Applications"
					href="apps"
					icon={<IconPhAppWindow />}
					value={counts()?.applications || 0}
				/>
				<StatItem
					title="Groups"
					href="groups"
					icon={<IconPhSelection />}
					value={counts()?.groups || 0}
				/>
			</div>
		</PageLayout>
	);
}
