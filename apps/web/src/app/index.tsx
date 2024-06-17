import { Navigate, useLocation, useSearchParams } from "@solidjs/router";
import { Match, Switch, createEffect } from "solid-js";

import { parse } from "cookie-es";
import { useCachedQueryData } from "~/cache";
import { trpc } from "~/lib";
import { cachedTenantsForOrg } from "./(dash)/o.[orgSlug]/utils";
import { cachedOrgs } from "./(dash)/utils";

export const route = {
	load: () => trpc.useContext().auth.me.ensureData(),
};

export default function Page() {
	const location = useLocation<{ action?: string }>();
	const [search] = useSearchParams<{ action?: string }>();
	const action = location.state?.action || search?.action;

	const query = trpc.org.list.createQuery();
	const orgs = useCachedQueryData(query, () => cachedOrgs());

	const defaultOrg = () => {
		const o = orgs();
		if (!o) return;

		return o[0] ?? null;
	};

	return (
		<Switch>
			<Match when={parse(document.cookie).isLoggedIn !== "true"}>
				<Navigate href="/login" />
			</Match>
			<Match when={defaultOrg() === null}>
				{
					(() => {
						if (query.data !== undefined)
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

					let tenantSuffix = "";
					let tenantState = undefined;
					if (action === "enrollDevice") {
						tenantSuffix = "/devices";
						tenantState = {
							enrollDialog: true,
						};
					}

					return (
						<Switch>
							<Match when={defaultTenant() === null}>
								<Navigate href={`/o/${org().slug}`} />
							</Match>
							<Match when={defaultTenant()}>
								{(tenant) => (
									<Navigate
										href={`/o/${org().slug}/t/${tenant().slug}${tenantSuffix}`}
										state={tenantState}
									/>
								)}
							</Match>
						</Switch>
					);
				}}
			</Match>
		</Switch>
	);
}
