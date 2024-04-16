/* @refresh skip */

import {
	type Component,
	For,
	type ParentProps,
	Suspense,
	createMemo,
	createEffect,
} from "solid-js";
import { useMatch, useMatches } from "@solidjs/router";

export function Breadcrumbs() {
	const matches = useMatches();

	const breadcrumbs = createMemo(() =>
		matches().flatMap((match) => {
			const Inner:
				| {
						Component: Component<{ href: string }>;
						hasNestedSegments?: boolean;
				  }
				| undefined = match.route.info?.BREADCRUMB;
			return Inner ? [{ ...Inner, match }] : [];
		}),
	);

	return (
		<div class="flex flex-row items-center text-sm font-medium space-x-2 text-gray-800">
			<For each={breadcrumbs()}>
				{({ Component, hasNestedSegments, match }) => {
					const _match = useMatch(() => `${match.path}/:segment/:subSegment/*`);

					const href = createMemo(() => {
						const __match = hasNestedSegments ? _match() : undefined;

						const ret = __match
							? `${match.path}/${__match.params.segment}`
							: match.path;

						return ret;
					});

					return (
						<Breadcrumb>
							<Component href={href()} />
						</Breadcrumb>
					);
				}}
			</For>
		</div>
	);
}

export function Breadcrumb(props: ParentProps) {
	return (
		<Suspense>
			<div class="flex flex-row items-center gap-2">
				<IconMdiSlashForward class="text-lg text-gray-300" />
				{props.children}
			</div>
		</Suspense>
	);
}
