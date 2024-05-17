/* @refresh skip */

import { useMatch, useMatches } from "@solidjs/router";
import {
	type Component,
	Index,
	type ParentProps,
	Suspense,
	createMemo,
	SuspenseList,
	Show,
} from "solid-js";
import { Dynamic } from "solid-js/web";

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
			<SuspenseList revealOrder="forwards" tail="collapsed">
				<Index each={breadcrumbs()}>
					{(b) => {
						const _match = useMatch(
							() => `${b().match.path}/:segment/:subSegment/*`,
						);

						const href = createMemo(() => {
							const __match = b().hasNestedSegments ? _match() : undefined;

							const ret = __match
								? `${b().match.path}/${__match.params.segment}`
								: b().match.path;

							return ret;
						});

						return (
							<Show when={b().Component} keyed>
								<Breadcrumb>
									<Dynamic component={b().Component} href={href()} />
								</Breadcrumb>
							</Show>
						);
					}}
				</Index>
			</SuspenseList>
		</div>
	);
}

export function Breadcrumb(props: ParentProps) {
	return (
		<div class="flex flex-row items-center gap-2">
			<Suspense
				fallback={
					<>
						<IconMdiSlashForward class="text-lg text-gray-300" />
						<div class="w-24 h-4 rounded-full bg-neutral-200 animate-pulse" />
					</>
				}
			>
				<IconMdiSlashForward class="text-lg text-gray-300" />
				{props.children}
			</Suspense>
		</div>
	);
}
