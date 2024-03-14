import { HttpStatusCode } from "@solidjs/start";

export default function () {
	return (
		<>
			<HttpStatusCode code={404} />
			<h1>Page Not Found</h1>
		</>
	);
}
