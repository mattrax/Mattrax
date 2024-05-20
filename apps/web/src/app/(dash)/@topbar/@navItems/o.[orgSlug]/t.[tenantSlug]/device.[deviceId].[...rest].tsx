import { useResolvedPath } from "@solidjs/router";

export default function () {
	const base = useResolvedPath(() => "");

	return {
		base: () => base()!,
		items: [
			{ title: "Device", href: "" },
			{ title: "Configuration", href: "configuration" },
			{ title: "Assignments", href: "assignments" },
			{ title: "Inventory", href: "inventory" },
			{ title: "Settings", href: "settings" },
		],
	};
}
