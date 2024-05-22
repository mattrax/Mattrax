import { NavItems } from "../../NavItems";

export default function () {
	return (
		<NavItems
			items={[
				{ title: "Dashboard", href: "" },
				{ title: "Users", href: "users" },
				{ title: "Devices", href: "devices" },
				{ title: "Policies", href: "policies" },
				{ title: "Applications", href: "apps" },
				{ title: "Groups", href: "groups" },
				{ title: "Settings", href: "settings" },
			]}
		/>
	);
}
