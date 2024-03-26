import {
	type Component,
	For,
	type ParentProps,
	Suspense,
	createMemo,
} from "solid-js";
import { A, useMatches } from "@solidjs/router";

export function Breadcrumbs() {
	const matches = useMatches();

	const breadcrumbs = createMemo(() =>
		matches().flatMap((match) => {
			const Inner: Component<{ path: string }> | undefined =
				match.route.info?.BREADCRUMB;
			return Inner ? [{ Inner, match }] : [];
		}),
	);

	return (
		<div class="flex flex-row items-center text-sm font-medium space-x-2 text-gray-800">
			<For each={breadcrumbs()}>
				{({ Inner, match }) => (
					<Breadcrumb href={match.path}>
						<Inner path={match.path} />
					</Breadcrumb>
				)}
			</For>
		</div>
	);
}

export function Breadcrumb(props: ParentProps<{ href: string }>) {
	return (
		<Suspense>
			<div class="flex flex-row items-center gap-2">
				<IconMdiSlashForward class="text-lg text-gray-300" />
				<A href={props.href} class="flex flex-row items-center py-1 gap-2">
					{props.children}
				</A>
			</div>
		</Suspense>
	);
}
