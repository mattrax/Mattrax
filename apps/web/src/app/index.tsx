import { Navigate } from "@solidjs/router";
import { Show } from "solid-js";

import { AuthContext, useAuth } from "~c/AuthContext";
import { trpc } from "~/lib";

export const route = {
	load: () => trpc.useContext().auth.me.ensureData(),
};

export default function Page() {
	const defaultOrg = () => {
		const orgs = useAuth()().orgs;
		if (orgs.length < 1) return;

		return orgs[0];
	};

	return (
		<AuthContext>
			<Show
				when={defaultOrg()}
				fallback={
					(() => {
						throw new Error(
							"No organisations found, re-login to create a default one.",
						);
					}) as any
				}
			>
				{(
					org, // If we have an active tenant, send the user to it
				) => <Navigate href={`o/${org().slug}`} />}
			</Show>
		</AuthContext>
	);
}
