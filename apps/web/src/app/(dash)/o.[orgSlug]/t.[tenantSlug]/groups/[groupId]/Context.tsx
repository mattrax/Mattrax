import { createContextProvider } from "@solid-primitives/context";
import { Navigate } from "@solidjs/router";
import { Match, ParentProps, Switch } from "solid-js";
import { z } from "zod";
import type { RouterOutput } from "~/api";
import { trpc } from "~/lib";
import { useZodParams } from "~/lib/useZodParams";

const [GroupContextProvider, useGroup] = createContextProvider(
	(props: {
		group: NonNullable<RouterOutput["group"]["get"]>;
		query: ReturnType<typeof trpc.group.get.createQuery>;
	}) => Object.assign(() => props.group, { query: props.query }),
	null!,
);

export { useGroup };

export function GroupContext(props: ParentProps) {
	const params = useZodParams({ groupId: z.string() });

	const group = trpc.group.get.createQuery(() => ({ id: params.groupId }));

	return (
		<Switch>
			<Match when={group.data === null}>
				<Navigate href=".." />
			</Match>
			<Match when={group.data}>
				{(data) => (
					<GroupContextProvider group={data()} query={group}>
						{props.children}
					</GroupContextProvider>
				)}
			</Match>
		</Switch>
	);
}
