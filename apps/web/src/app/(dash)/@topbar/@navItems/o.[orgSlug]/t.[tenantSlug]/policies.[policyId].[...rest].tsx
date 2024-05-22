import { NavItems } from "../../NavItems";

export default function () {
	return (
		<NavItems
			items={[
				{ title: "Policy", href: "" },
				{ title: "Edit", href: "edit" },
				{ title: "Deploys", href: "deploys" },
				{ title: "Assignees", href: "assignees" },
				{ title: "Settings", href: "settings" },
			]}
		/>
	);
}
