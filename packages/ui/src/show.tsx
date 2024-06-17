// import { type JSX, createSignal, Show, type Accessor } from "solid-js";
// import createPresence from "solid-presence";

// type RequiredParameter<T> = T extends () => unknown ? never : T;

// export function ShowWithPresence<
// 	T,
// 	TRenderFunction extends (
// 		ref: ((el: HTMLElement | null) => void) & { visible: Accessor<boolean> },
// 		item: Accessor<T>,
// 	) => JSX.Element,
// >(props: {
// 	when: T | undefined | null | false;
// 	keyed?: false;
// 	fallback?: JSX.Element;
// 	children: RequiredParameter<TRenderFunction>;
// }) {
// 	const [ref, setRef] = createSignal<HTMLElement | null>(null);
// 	const [value, setValue] = createSignal<unknown>(props.when);

// 	const { present } = createPresence({
// 		show: () => {
// 			//@ts-expect-error
// 			setValue(props.when ? props.when : undefined);
// 			return !!props.when;
// 		},
// 		element: ref,
// 	});

// 	const arg: typeof setRef & { visible: Accessor<boolean> } = Object.assign(
// 		setRef,
// 		{
// 			visible: () => !!props.when,
// 		},
// 	);

// 	return (
// 		<Show when={present()} fallback={props.fallback} keyed={props.keyed}>
// 			{
// 				// @ts-expect-error
// 				props.children(arg, value)
// 			}
// 		</Show>
// 	);
// }
