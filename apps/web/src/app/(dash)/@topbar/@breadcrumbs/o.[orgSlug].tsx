import { A, type RouteSectionProps } from "@solidjs/router";

import { useOrgSlug } from "../../o.[orgSlug]/ctx";
import { useOrgs } from "../../utils";
import { Breadcrumb } from "./Breadcrumb";
import { MultiSwitcher } from "./MultiSwitcher";

export default function (props: RouteSectionProps) {
	const orgSlug = useOrgSlug();
	const orgs = useOrgs();

	const org = () => orgs.data?.find((o) => o.slug === orgSlug());

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
