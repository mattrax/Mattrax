import { createContextProvider } from "@solid-primitives/context";
import { type ParentProps, Show, createMemo } from "solid-js";
import { z } from "zod";

import type { RouterOutput } from "~/api";
import { useZodParams } from "~/lib/useZodParams";
import { trpc } from "~/lib";

const [OrgContextProvider, useOrg] = createContextProvider(
	(props: { org: RouterOutput["org"]["list"][number] }) => () => props.org,
	null!,
);

export { useOrg };

export function OrgContext(props: ParentProps) {
	const params = useZodParams({ orgSlug: z.string() });
	const orgs = trpc.org.list.createQuery();

	const activeOrg = createMemo(() =>
		orgs.data?.find((o) => o.slug === params.orgSlug),
	);

	return (
		<Show
			when={activeOrg()}
			// fallback={
			// 	<Navigate
			// 		href={() => {
			// 			const firstOrg = auth().orgs[0];
			// 			return firstOrg?.slug ? `../${firstOrg.slug}` : "/";
			// 		}}
			// 	/>
			// }
		>
			{(org) => (
				<OrgContextProvider org={org()}>{props.children}</OrgContextProvider>
			)}
		</Show>
	);
}
