import type { RouteDefinition } from "@solidjs/router";
import type { ParentProps } from "solid-js";
import { z } from "zod";

import { MErrorBoundary } from "~c/MattraxErrorBoundary";
import { useZodParams } from "~/lib/useZodParams";
import { trpc } from "~/lib";
import { createNotFoundRedirect } from "~/lib/utils";

export function useGroupId() {
	const params = useZodParams({ groupId: z.string() });
	return () => params.groupId;
}

export const route = {
	load: ({ params }) =>
		trpc.useContext().group.get.ensureData({
			id: params.groupId!,
		}),
} satisfies RouteDefinition;

export default function Layout(props: ParentProps) {
	const params = useZodParams({ groupId: z.string() });

	createNotFoundRedirect({
		query: trpc.group.get.createQuery(() => ({ id: params.groupId })),
		toast: "Group not found",
		to: "../../groups",
	});

	return <MErrorBoundary>{props.children}</MErrorBoundary>;
}
