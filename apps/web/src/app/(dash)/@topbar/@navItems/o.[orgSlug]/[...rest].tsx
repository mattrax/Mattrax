import { NavItems } from "../NavItems";

export default function () {
	return (
		<NavItems
			items={[
				{ title: "Overview", href: "" },
				{ title: "Settings", href: "settings" },
			]}
		/>
	);
}
