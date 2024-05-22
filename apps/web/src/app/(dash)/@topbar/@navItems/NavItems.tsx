import { useResolvedPath } from "@solidjs/router";
import { JSX } from "solid-js";

export function NavItems(props: {
	items: Array<{ title: string; href: string }>;
}) {
	const base = useResolvedPath(() => "");

	return {
		base: () => base()!,
		get items() {
			return props.items;
		},
	} as unknown as JSX.Element;
}
