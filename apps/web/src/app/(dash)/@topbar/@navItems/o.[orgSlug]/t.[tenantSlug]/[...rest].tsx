import { useResolvedPath } from "@solidjs/router";

export default function () {
	const base = useResolvedPath(() => "");

	return {
		base: () => base()!,
		items: [
			{ title: "Dashboard", href: "" },
			{ title: "Users", href: "users" },
			{ title: "Devices", href: "devices" },
			{ title: "Policies", href: "policies" },
			{ title: "Applications", href: "apps" },
			{ title: "Groups", href: "groups" },
			{ title: "Settings", href: "settings" },
		],
	};
}
