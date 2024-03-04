import { useNavigate } from "@solidjs/router";
import { Button } from "~/components/ui";

export default function NotFound() {
	const navigate = useNavigate();
	return (
		<div class="p-4 flex flex-col justify-center items-center">
			<OscarTriedToDesignAMattraxLogoButFailedPrettyHard class="w-60" />
			<h1 class="text-3xl font-bold mb-4">404 Not Found</h1>
			<h2>Oh no, the page you requested was not found</h2>
			<Button onClick={() => navigate("/")} class="mt-4">
				Go Home
			</Button>
		</div>
	);
}

function OscarTriedToDesignAMattraxLogoButFailedPrettyHard(props: {
	class?: string;
}) {
	return (
		<svg
			viewBox="0 0 500 500"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
			class={props.class}
		>
			<title>Sad Face SVG</title>
			<rect
				width="500"
				height="500"
				transform="matrix(-1 0 0 1 500 0)"
				fill="white"
			/>
			<path
				d="M456 239.467C456 307.103 417.944 167.852 371 167.852C324.056 167.852 286 307.103 286 239.467C286 171.83 324.056 117 371 117C417.944 117 456 171.83 456 239.467Z"
				fill="black"
			/>
			<path
				d="M198 241.467C198 309.103 159.944 169.852 113 169.852C66.0558 169.852 28 309.103 28 241.467C28 173.83 66.0558 119 113 119C159.944 119 198 173.83 198 241.467Z"
				fill="black"
			/>
			<rect
				width="80"
				height="350.092"
				rx="24"
				transform="matrix(0 -1 -1 0 415.093 381)"
				fill="black"
			/>
		</svg>
	);
}
