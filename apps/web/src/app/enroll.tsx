import { renderToString } from "solid-js/web";
import css from "@mattrax/ui/css?url";
import { Document } from "../entry-server";

function App() {
	return (
		<div class="flex-grow flex justify-center items-center">
			<div class="w-full flex flex-col items-center justify-center">
				<div class="sm:mx-auto sm:w-full sm:max-w-md flex items-center justify-center pb-2">
					<h2 class="mt-4 text-center text-4xl font-bold leading-9 tracking-tight text-gray-900">
						Mattrax
					</h2>
				</div>

				<p>TODO: Enroll screen</p>

				{/* <CardDescription>
				Please enter your company email to get started
			</CardDescription> */}
			</div>
		</div>
	);
}

// Poor mans way to SSR only this route with Solid Start
export function GET() {
	return new Response(
		renderToString(() => (
			<Document
				title="Enroll in Mattrax"
				head={<link rel="stylesheet" href={css} />}
			>
				<App />
			</Document>
		)),
		{
			headers: {
				"content-type": "text/html",
			},
		},
	);
}
