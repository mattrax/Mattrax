import { useLocation } from "@solidjs/router";

export default function () {
	const url = `ms-device-enrollment:?mode=mdm&username=${encodeURIComponent("enroll@mattrax.app")}&servername=${encodeURIComponent(
		window.origin,
	)}`;

	return <a href={url}>Enroll</a>;
}
