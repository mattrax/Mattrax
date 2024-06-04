// @refresh reload
import { StartServer, createHandler } from "@solidjs/start/server";

export default createHandler(
	(event) => (
		<StartServer
			document={({ assets, children, scripts }) => (
				<html lang="en" class="h-full">
					<head>
						<meta charset="UTF-8" />
						{/* <link rel="icon" type="image/svg+xml" href="/vite.svg" /> */}
						<meta
							name="viewport"
							content="width=device-width, initial-scale=1.0"
						/>
						{assets}
					</head>
					<body class="h-full">
						<div id="app" class="flex min-h-full flex-col">
							{new URL(event.request.url).pathname !== "/enroll" ? (
								<>
									{children}

									<noscript>
										<NoScriptFallback />
									</noscript>
								</>
							) : null}
						</div>
						{scripts}
					</body>
				</html>
			)}
		/>
	),
	{
		mode: "async", // TODO: sync mode is broken in Solid Start
	},
);

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
