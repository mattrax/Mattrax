import { createContextProvider } from "@solid-primitives/context";
import { ParentProps, Suspense, createSignal } from "solid-js";
import { Portal } from "solid-js/web";
import { A } from "@solidjs/router";
import IconMdiSlashForward from "~icons/mdi/slash-forward.jsx";

const [ContextProvider, useContext] = createContextProvider(() => {
	const [ref, setRef] = createSignal<HTMLDivElement>(null!);

	return { ref, setRef };
}, null!);

export function BreadcrumbsRoot(props: ParentProps) {
	return <ContextProvider>{props.children}</ContextProvider>;
}

export function Breadcrumbs() {
	const { setRef } = useContext();

	return (
		<div
			class="flex flex-row items-center text-sm font-medium space-x-2 text-gray-800"
			ref={setRef}
		/>
	);
}

export function Breadcrumb(props: ParentProps) {
	const { ref } = useContext();

	return (
		<Portal mount={ref()}>
			<Suspense>
				<A href="" class="flex flex-row items-center">
					<div class="flex flex-row items-center gap-2">
						<IconMdiSlashForward class="text-lg text-gray-300" />
						{props.children}
					</div>
				</A>
			</Suspense>
		</Portal>
	);
}
