import { NavItems } from "../../NavItems";

export default function () {
	return (
		<NavItems
			items={[
				{ title: "Device", href: "" },
				{ title: "Configuration", href: "configuration" },
				{ title: "Assignments", href: "assignments" },
				{ title: "Inventory", href: "inventory" },
				{ title: "Settings", href: "settings" },
			]}
		/>
	);
}
