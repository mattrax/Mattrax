import { ParentProps, JSX } from "solid-js";

export function Breadcrumb(props: ParentProps) {
	return { breadcrumb: <>{props.children}</> } as unknown as JSX.Element;
}
