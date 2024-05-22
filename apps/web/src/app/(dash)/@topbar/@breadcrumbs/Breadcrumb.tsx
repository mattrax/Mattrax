import type { ParentProps, JSX } from "solid-js";

// we use a dedicated object since otherwise all the fragments would merge
export function Breadcrumb(props: ParentProps) {
	return { breadcrumb: <>{props.children}</> } as unknown as JSX.Element;
}
