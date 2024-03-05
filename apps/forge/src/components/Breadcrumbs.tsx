import { createContextProvider } from "@solid-primitives/context";
import { ComponentProps } from "solid-js";
import { ParentProps, createSignal } from "solid-js";
import { Portal } from "solid-js/web";

const [ContextProvider, useContext] = createContextProvider(() => {
	const [ref, setRef] = createSignal<HTMLDivElement>(null!);

	return { ref, setRef };
}, null!);

export function BreadcrumbsRoot(props: ParentProps) {
	return <ContextProvider>{props.children}</ContextProvider>;
}

export function Breadcrumbs() {
	const { setRef } = useContext();

	return <div class="flex flex-row items-center" ref={setRef} />;
}

export function Breadcrumb(props: ParentProps) {
	const { ref } = useContext();

	return (
		<Portal mount={ref()}>
			<div class="flex flex-row items-center gap-2">
				<span class="text-xl text-gray-300 mx-2">/</span>
				{props.children}
			</div>
		</Portal>
	);
}
