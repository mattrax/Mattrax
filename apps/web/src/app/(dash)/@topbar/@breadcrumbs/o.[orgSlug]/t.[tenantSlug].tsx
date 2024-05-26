import {
	A,
	type RouteSectionProps,
	useMatch,
	useResolvedPath,
} from "@solidjs/router";
import { Show } from "solid-js";

import { createQueryCacher, useCachedQueryData } from "~/cache";
import { trpc } from "~/lib";
import { cachedTenantsForOrg } from "~[orgSlug]/utils";
import { cachedOrgs } from "~dash/utils";
import { Breadcrumb } from "../Breadcrumb";
import { MultiSwitcher } from "../MultiSwitcher";
import { useTenantParams } from "~/app/(dash)/o.[orgSlug]/t.[tenantSlug]/ctx";

export default function (props: RouteSectionProps) {
	const params = useTenantParams();

	const query = trpc.org.list.createQuery();
	const orgs = useCachedQueryData(query, () => cachedOrgs());
	const org = () => orgs()?.find((o) => o.slug === params.orgSlug);

	return (
		<>
			<Breadcrumb>
				<Show when={org()}>
					{(org) => {
						const query = trpc.tenant.list.createQuery(() => ({
							orgSlug: params.orgSlug,
						}));
						createQueryCacher(query, "tenants", (t) => ({ ...t }));
						const tenants = useCachedQueryData(query, () =>
							cachedTenantsForOrg(org().id),
						);

						const tenant = () =>
							tenants()?.find((t) => t.slug === params.tenantSlug);

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
