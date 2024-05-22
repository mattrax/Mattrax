import { createContextProvider } from "@solid-primitives/context";
import { type ParentProps, Show, createMemo } from "solid-js";
import { z } from "zod";

import type { RouterOutput } from "~/api";
import { trpc } from "~/lib";
import { useZodParams } from "~/lib/useZodParams";

const [OrgContextProvider, useOrg] = createContextProvider(
	(props: {
		query: ReturnType<typeof trpc.tenant.list.createQuery>;
		org: RouterOutput["org"]["list"][number];
	}) => Object.assign(() => props.org, { query: props.query }),
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
				<OrgContextProvider query={orgs} org={org()}>
					{props.children}
				</OrgContextProvider>
			)}
		</Show>
	);
}
