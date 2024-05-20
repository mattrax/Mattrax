import { useResolvedPath } from "@solidjs/router";

export default function () {
	const base = useResolvedPath(() => "");

	return {
		base: () => base()!,
		items: [
			{ title: "Group", href: "" },
			{ title: "Members", href: "members" },
			{ title: "Assignments", href: "assignments" },
		],
	};
}
