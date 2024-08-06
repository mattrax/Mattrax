import { A, type RouteSectionProps } from "@solidjs/router";

import { createQueryCacher, useCachedQueryData } from "~/cache";
import { trpc } from "~/lib";
import { useOrgSlug } from "../../o/o.[orgSlug]/ctx";
import { cachedOrgs } from "../../utils";
import { Breadcrumb } from "./Breadcrumb";
import { MultiSwitcher } from "./MultiSwitcher";

export default function (props: RouteSectionProps) {
	const orgSlug = useOrgSlug();

	const query = trpc.org.list.createQuery();
	createQueryCacher(query, "orgs", (org) => ({
		id: org.id,
		name: org.name,
		slug: org.slug,
	}));
	const orgs = useCachedQueryData(query, () => cachedOrgs());

	const org = () => orgs()?.find((o) => o.slug === orgSlug());

	return (
		<>
			<Breadcrumb>
				<div class="flex flex-row items-center py-1 gap-2">
					<A href="">{org()?.name}</A>
					<MultiSwitcher />
				</div>
			</Breadcrumb>
			{props.children}
		</>
	);
}
