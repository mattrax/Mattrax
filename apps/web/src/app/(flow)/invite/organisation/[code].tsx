import { Match, Suspense, Switch, onMount } from "solid-js";
import { z } from "zod";

import { withDependantQueries } from "@mattrax/trpc-server-function/client";
import { CardDescription, buttonVariants } from "@mattrax/ui";
import clsx from "clsx";
import { trpc } from "~/lib";
import { useZodParams } from "~/lib/useZodParams";

export default function Page() {
	const params = useZodParams({ code: z.string() });

	const me = trpc.auth.me.createQuery(void 0, () => ({ enabled: false }));
	const acceptOrgInvite = trpc.org.admins.acceptInvite.createMutation(() => ({
		...withDependantQueries(me),
	}));

	onMount(() => acceptOrgInvite.mutate(params));

	return (
		<Suspense fallback={<p>Loading...</p>}>
			<Switch fallback={<p>Loading...</p>}>
				<Match when={acceptOrgInvite.error}>
					<CardDescription>Error accepting invitation</CardDescription>
				</Match>
				<Match when={acceptOrgInvite.data === null}>
					<CardDescription>Invalid invitation code!</CardDescription>
				</Match>
				<Match when={acceptOrgInvite.data}>
					{(org) => (
						<>
							<CardDescription>
								You are now an administrator of <b>{org().name}</b>.
							</CardDescription>

							<a
								class={clsx(buttonVariants(), "mt-2")}
								href={`/o/${org().slug}`}
							>
								Go to organisation
							</a>
						</>
					)}
				</Match>
			</Switch>
		</Suspense>
	);
}
