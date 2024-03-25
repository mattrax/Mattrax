import { createContextProvider } from "@solid-primitives/context";
import { type ParentProps, Show, createMemo } from "solid-js";
import { z } from "zod";
import { Navigate } from "@solidjs/router";

import type { RouterOutput } from "~/api";
import { useAuth } from "~c/AuthContext";
import { useZodParams } from "~/lib/useZodParams";

const [OrgContextProvider, useOrg] = createContextProvider(
	(props: {
		org: RouterOutput["auth"]["me"]["orgs"][number];
	}) =>
		() =>
			props.org,
	null!,
);

export { useOrg };

export function OrgContext(props: ParentProps) {
	const params = useZodParams({ orgSlug: z.string() });
	const auth = useAuth();

	const activeOrg = createMemo(() =>
		auth().orgs.find((o) => o.slug === params.orgSlug),
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
