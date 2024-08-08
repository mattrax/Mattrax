import { PageLayout, PageLayoutHeading } from "~/components/PageLayout";
import { StatItem } from "~/components/StatItem";
import { createDbQuery } from "~/lib/query";

export default function Page() {
	const counts = createDbQuery(async (db) => {
		return {
			users: await db.count("users"),
			devices: await db.count("devices"),
			groups: await db.count("groups"),
			policies: await db.count("policies"),
			scripts: await db.count("scripts"),
			applications: await db.count("apps"),
		};
	});

	return (
		<PageLayout heading={<PageLayoutHeading>Overview</PageLayoutHeading>}>
			<div class="grid gap-4 grid-cols-6">
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
					title="Scripts"
					href="scripts"
					icon={<IconPhTerminal />}
					value={counts()?.scripts || 0}
				/>
				<StatItem
					title="Applications"
					href="applications"
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
