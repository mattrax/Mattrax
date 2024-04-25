import { Navigate } from "@solidjs/router";
import { Match, Switch } from "solid-js";

import { trpc } from "~/lib";

export const route = {
	load: () => trpc.useContext().auth.me.ensureData(),
};

export default function Page() {
	const orgs = trpc.org.list.createQuery();

	const defaultOrg = () => {
		if (!orgs.data) return;
		if (orgs.data.length < 1) return null;

		return orgs.data[0];
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
					const tenants = trpc.tenant.list.createQuery(() => ({
						orgSlug: org().slug,
					}));

					const defaultTenant = () => {
						if (!tenants.data) return;
						if (tenants.data.length < 1) return null;

						return tenants.data[0];
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
