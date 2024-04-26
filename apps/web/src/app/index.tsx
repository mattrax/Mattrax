import { Navigate } from "@solidjs/router";
import { Match, Switch } from "solid-js";

import { useCachedQueryData } from "~/cache";
import { trpc } from "~/lib";
import { cachedOrgs } from "./(dash)/utils";
import { cachedTenantsForOrg } from "./(dash)/o.[orgSlug]/utils";

export const route = {
	load: () => trpc.useContext().auth.me.ensureData(),
};

export default function Page() {
	const query = trpc.org.list.createQuery();
	const orgs = useCachedQueryData(query, () => cachedOrgs());

	const defaultOrg = () => {
		const o = orgs();
		if (!o) return;

		return o[0] ?? null;
	};

	return (
		<Switch>
			<Match when={defaultOrg() === null}>
				{
					(() => {
						throw new Error(
							"No organisations found, re-login to create a default one.",
						);
					}) as any
				}
			</Match>
			<Match when={defaultOrg()}>
				{(
					org, // If we have an active tenant, send the user to it
				) => {
					const query = trpc.tenant.list.createQuery(() => ({
						orgSlug: org().slug,
					}));
					const tenants = useCachedQueryData(query, () =>
						cachedTenantsForOrg(org().id),
					);

					const defaultTenant = () => {
						const t = tenants();
						if (!t) return;

						return t[0] ?? null;
					};

					return (
						<Switch>
							<Match when={defaultTenant() === null}>
								<Navigate href={`/o/${org().slug}`} />
							</Match>
							<Match when={defaultTenant()}>
								{(tenant) => (
									<Navigate href={`/o/${org().slug}/t/${tenant().slug}`} />
								)}
							</Match>
						</Switch>
					);
				}}
			</Match>
		</Switch>
	);
}
