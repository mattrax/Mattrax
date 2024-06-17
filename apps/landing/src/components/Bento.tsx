import clsx from "clsx";
import allplatforms from "../assets/allplatforms.webp";
import applications from "../assets/applications.svg";
import integrations from "../assets/integrations.webp";
import versioning from "../assets/versioning.webp";

const Bento = () => {
	return (
		<div class="bento-grid max-w-[1000px] mx-auto mt-32 mb-10 px-5">
			{info.map((item, i) => (
				<div
					style={boxStyling[i]?.bgStyle}
					class={clsx(
						"bg-white p-5 bento-shadow rounded-lg h-[400px] border border-zinc-200 w-full",
						boxStyling[i]?.width,
						boxStyling[i]?.class,
					)}
				>
					<h1 class="font-bold text-lg mb-1">{item.title}</h1>
					<p class="text-sm text-zinc-500 w-full max-w-[300px]">
						{item.description}
					</p>
				</div>
			))}
		</div>
	);
};

const info = [
	{
		title: "Supports all platforms",
		description:
			"Supports Windows, macOS and iOS with Android and Linux coming soon.",
	},
	{
		title: "Application & patch management",
		description:
			"Manage software and operating system updates to keep everything is secure.",
	},
	{
		title: "Integrations",
		description:
			"Built-in support for configuring 3rd party software, with a flexible API.",
	},
	{
		title: "Versioning",
		description:
			"Track changes to your configuration, require your teams approval and quickly roll-back mistakes.",
	},
];

const boxStyling: Record<
	number,
	{
		width: string;
		bgStyle: Record<string, any>;
		class?: string;
	}
> = {
	0: {
		width: "lg:w-[60%]",
		bgStyle: {
			"background-image": `url(${allplatforms})`,
			"background-size": "500px",
			"background-repeat": "no-repeat",
			"background-position": "bottom",
		},
		class: "allplatforms-box",
	},
	1: {
		width: "lg:w-[37.5%]",
		bgStyle: {
			"background-image": `url(${applications})`,
			"background-repeat": "no-repeat",
			"background-size": "500px",
			"background-position": "50% 20px",
		},
		class: "applications-box",
	},
	2: {
		width: "lg:w-[37.5%]",
		bgStyle: {
			"background-image": `url(${integrations})`,
			"background-repeat": "no-repeat",
			"background-position": "50% 100%",
			"background-size": "320px",
		},
	},
	3: {
		width: "lg:w-[60%]",
		bgStyle: {
			"background-image": `url(${versioning})`,
			"background-repeat": "no-repeat",
			"background-size": "550px",
			"background-position": "50% 30px",
		},
		class: "versioning-box",
	},
};

export default Bento;
