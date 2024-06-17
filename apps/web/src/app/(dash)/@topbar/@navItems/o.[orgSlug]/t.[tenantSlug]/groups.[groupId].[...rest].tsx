import { NavItems } from "../../NavItems";

export default function () {
	return (
		<NavItems
			items={[
				{ title: "Group", href: "" },
				{ title: "Members", href: "members" },
				{ title: "Assignments", href: "assignments" },
			]}
		/>
	);
}
