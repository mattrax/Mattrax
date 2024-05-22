import { Show, onMount } from "solid-js";
import { z } from "zod";

import { withDependantQueries } from "@mattrax/trpc-server-function/client";
import { Card, CardDescription, CardHeader, buttonVariants } from "@mattrax/ui";
import { trpc } from "~/lib";
import { useZodParams } from "~/lib/useZodParams";

export default function Page() {
	const params = useZodParams({ code: z.string() });

	const me = trpc.auth.me.createQuery(void 0, () => ({ enabled: false }));
	const acceptTenantInvite = trpc.org.admins.acceptInvite.createMutation(
		() => ({
			...withDependantQueries(me),
		}),
	);

	onMount(() => acceptTenantInvite.mutateAsync(params));

	return (
		<Show when={acceptTenantInvite.data} fallback="Loading...">
			{(tenant) => (
				<Card>
					<CardHeader>
						<CardDescription>
							You are now an administrator of <b>{tenant().name}</b>.
						</CardDescription>
					</CardHeader>
					<a class={buttonVariants()} href={`/o/${tenant().slug}`}>
						Go to tenant
					</a>
				</Card>
			)}
		</Show>
	);
}
