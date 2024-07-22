// @refresh reload
import css from "@mattrax/ui/css?url";
import { StartServer, createHandler } from "@solidjs/start/server";
import type { JSX, ParentProps } from "solid-js";
import { renderToString } from "solid-js/web";

export function Document(
	props: ParentProps<{ title?: string; head?: JSX.Element }>,
) {
	return (
		<html lang="en" class="h-full">
			<head>
				<meta charset="UTF-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1.0" />
				<link rel="icon" href="/favicon.ico" />
				<title>{props.title || "Mattrax"}</title>
				<meta name="robots" content="noindex" />

				{props.head ?? null}
			</head>
			<body class="h-full">{props.children}</body>
		</html>
	);
}

export default createHandler(() => (
	<StartServer
		document={({ assets, children, scripts }) => (
			<Document head={assets}>
				<div id="app" class="flex min-h-full w-screen flex-col">
					{children}

					<noscript class="h-screen w-full flex">
						<NoScriptFallback />
					</noscript>
				</div>
				{scripts}
			</Document>
		)}
	/>
));

function NoScriptFallback() {
	return (
		<div class="flex-grow flex justify-center items-center">
			<div class="w-full flex flex-col items-center justify-center">
				<div class="sm:mx-auto sm:w-full sm:max-w-md flex items-center justify-center pb-2">
					<h2 class="mt-4 text-center text-4xl font-bold leading-9 tracking-tight text-gray-900">
						Mattrax
					</h2>
				</div>

				<p class="text-muted-foreground text-md text-center">
					Your browser does not support JavaScript. <br /> Please enable it to
					use Mattrax.
				</p>
			</div>
		</div>
	);
}

export function renderWithApp(fn: () => JSX.Element, status = 200) {
	return new Response(
		renderToString(() => (
			<Document
				title="Enroll in Mattrax"
				head={
					<link
						rel="stylesheet"
						href={css.replace("/_build/assets/", "/assets/")}
					/>
				}
			>
				{fn()}
			</Document>
		)),
		{
			status,
			headers: {
				"content-type": "text/html",
			},
		},
	);
}
