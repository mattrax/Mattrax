import {
	Navigate,
	useLocation,
	useNavigate,
	useSearchParams,
} from "@solidjs/router";
import { Match, Switch, createEffect } from "solid-js";

import { Button, Delayed } from "@mattrax/ui";
import { parse } from "cookie-es";
import { trpc } from "~/lib";
import { useTenantsForOrg } from "./(dash)/o.[orgSlug]/utils";
import { useOrgs } from "./(dash)/utils";

export const route = {
	load: () => {
		trpc.useContext().auth.me.ensureData();
		trpc.useContext().org.list.ensureData();
	},
};

export default function Page() {
	const navigate = useNavigate();
	const location = useLocation<{ action?: string }>();
	const [search] = useSearchParams<{ action?: string }>();
	const action = location.state?.action || search?.action;

	const orgs = useOrgs();

	const defaultOrg = () => {
		const o = orgs.data;
		if (!o) return; // `undefined` is loading
		return o[0] ?? null; // `null` means no orgs
	};

	return (
		<Switch
			fallback={
				// We delay rendering in the hope the data comes back quick enough
				<Delayed delay={300}>
					<div class="flex-1 flex flex-col justify-center items-center space-y-2">
						<IconSvgSpinners90Ring width="2.5em" height="2.5em" />
						<p>Loading...</p>
					</div>
				</Delayed>
			}
		>
			{/* When not authenticated we send the user back to login */}
			<Match when={parse(document.cookie).isLoggedIn !== "true"}>
				<Navigate href="/login" />
			</Match>
			{/* If the user doesn't have any organisations */}
			<Match when={defaultOrg() === null}>
				<div class="flex-1 flex flex-col justify-center items-center space-y-2">
					<h1 class="text-3xl font-semibold">No organisations found</h1>
					<p class="text-gray-600 max-w-4xl text-center">
						You must re-login to create a default one. <br /> If this does not
						work please contact{" "}
						<a href="mailto:hello@mattrax.app" class="underline">
							hello@mattrax.app
						</a>
						!
					</p>
					<Button
						onClick={() => {
							document.cookie = "isLoggedIn=false";
							navigate("/login");
						}}
					>
						Try again
					</Button>
				</div>
			</Match>
			<Match when={defaultOrg()}>
				{(
					org, // If we have an active tenant, send the user to it
				) => {
					const tenants = useTenantsForOrg(() => org().id);

					const defaultTenant = () => {
						const t = tenants.data;
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
