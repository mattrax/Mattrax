import {
	A,
	type RouteSectionProps,
	useMatch,
	useResolvedPath,
} from "@solidjs/router";
import { Show } from "solid-js";

import { useTenantParams } from "~/app/(dash)/o.[orgSlug]/t.[tenantSlug]/ctx";
import { useTenantsForOrg } from "~/app/(dash)/o.[orgSlug]/utils";
import { useOrgs } from "~/app/(dash)/utils";
import { Breadcrumb } from "../Breadcrumb";
import { MultiSwitcher } from "../MultiSwitcher";

export default function (props: RouteSectionProps) {
	const params = useTenantParams();

	const orgs = useOrgs();
	const org = () => orgs.data?.find((o) => o.slug === params.orgSlug);

	return (
		<>
			<Breadcrumb>
				<Show when={org()}>
					{(org) => {
						const tenants = useTenantsForOrg(() => org().id);
						const tenant = () =>
							tenants.data?.find((t) => t.slug === params.tenantSlug);

						const base = useResolvedPath(() => "");
						const match = useMatch(() => `${base()}/:segment/:subSegment/*`);

						return (
							<div class="flex flex-row items-center py-1 gap-2">
								<A href={match()?.params.segment ?? ""}>{tenant()?.name}</A>
								<MultiSwitcher />
							</div>
						);
					}}
				</Show>
			</Breadcrumb>
			{props.children}
		</>
	);
}
