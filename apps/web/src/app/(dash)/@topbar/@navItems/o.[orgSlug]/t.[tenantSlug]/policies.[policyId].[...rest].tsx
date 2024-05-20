import { useResolvedPath } from "@solidjs/router";

export default function () {
	const base = useResolvedPath(() => "");

	return {
		base: () => base()!,
		items: [
			{ title: "Policy", href: "" },
			{ title: "Edit", href: "edit" },
			{ title: "Deploys", href: "deploys" },
			{ title: "Assignees", href: "assignees" },
			{ title: "Settings", href: "settings" },
		],
	};
}
