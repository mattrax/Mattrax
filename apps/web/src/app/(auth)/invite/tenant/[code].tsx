import { Show, onMount } from "solid-js";
import { z } from "zod";

import { Card, CardDescription, CardHeader, buttonVariants } from "@mattrax/ui";
import { trpc } from "~/lib";
import { useZodParams } from "~/lib/useZodParams";

export default function Page() {
	const params = useZodParams({ code: z.string() });

	const trpcCtx = trpc.useContext();
	const acceptTenantInvite = trpc.tenant.admins.acceptInvite.useMutation(
		() => ({ onSuccess: async () => await trpcCtx.auth.me.refetch() }),
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
					<a class={buttonVariants()} href={`/${tenant().id}`}>
						Go to tenant
					</a>
				</Card>
			)}
		</Show>
	);
}
