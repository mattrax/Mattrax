import {
	type Component,
	For,
	type ParentProps,
	Suspense,
	createMemo,
	createEffect,
} from "solid-js";
import { A, useMatch, useMatches, useResolvedPath } from "@solidjs/router";

export function Breadcrumbs() {
	const matches = useMatches();

	const breadcrumbs = createMemo(() =>
		matches().flatMap((match) => {
			const Inner:
				| {
						Component: Component<{ path: string }>;
						hasNestedSegments?: boolean;
				  }
				| undefined = match.route.info?.BREADCRUMB;
			return Inner ? [{ ...Inner, match }] : [];
		}),
	);

	return (
		<div class="flex flex-row items-center text-sm font-medium space-x-2 text-gray-800">
			<For each={breadcrumbs()}>
				{({ Component, hasNestedSegments, match }) => (
					<Breadcrumb href={match.path} hasNestedSegments={hasNestedSegments}>
						<Component path={match.path} />
					</Breadcrumb>
				)}
			</For>
		</div>
	);
}

export function Breadcrumb(
	props: ParentProps<{ href: string; hasNestedSegments?: boolean }>,
) {
	const _match = useMatch(() => `${props.href}/:segment/:subSegment/*`);

	const href = createMemo(() => {
		const match = props.hasNestedSegments ? _match() : undefined;
		console.log(match);

		return match ? `${props.href}/${match.params.segment}` : props.href;
	});

	return (
		<Suspense>
			<div class="flex flex-row items-center gap-2">
				<IconMdiSlashForward class="text-lg text-gray-300" />
				<A href={href()} class="flex flex-row items-center py-1 gap-2">
					{props.children}
				</A>
			</div>
		</Suspense>
	);
}
