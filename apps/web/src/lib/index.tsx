import {
	type CreateTRPCSolidStart,
	createTRPCSolidStart,
} from "@solid-mediakit/trpc";
import { TRPCClientError, httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "~/api";

export const trpc: CreateTRPCSolidStart<AppRouter> = createTRPCSolidStart({
	config: () => ({
		links: [
			httpBatchLink({
				url: `${location.origin}/api/trpc`,
			}),
		],
		transformer: superjson,
	}),
});

export function SuspenseError(props: { name: string }) {
	// Hitting the certain higher-level suspense boundaries means we don't have a UI to show which is a bad UI so we log the warning.
	console.warn(`${props.name}Suspense triggered!`);
	return <></>;
}

// https://trpc.io/docs/client/vanilla/infer-types#infer-trpcclienterror-types
export function isTRPCClientError(
	cause: unknown,
): cause is TRPCClientError<AppRouter> {
	return cause instanceof TRPCClientError;
}

export const isDebugMode = () => localStorage.getItem("mttxDebug") === "1";

export function getInitials(string: string) {
	const names = string.split(" ");
	// @ts-expect-error
	let initials = names[0].substring(0, 1).toUpperCase();

	if (names.length > 1) {
		// @ts-expect-error
		initials += names[names.length - 1].substring(0, 1).toUpperCase();
	}
	return initials;
}
