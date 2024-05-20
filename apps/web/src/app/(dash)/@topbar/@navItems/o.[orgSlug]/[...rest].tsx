import { useResolvedPath } from "@solidjs/router";

export default function () {
	const base = useResolvedPath(() => "");

	return {
		base: () => base()!,
		items: [
			{ title: "Overview", href: "" },
			{ title: "Settings", href: "settings" },
		],
	};
}
