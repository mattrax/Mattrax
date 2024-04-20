// @refresh reload
import { createHandler, StartServer } from "@solidjs/start/server";

export default createHandler(() => (
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
						{children}
					</div>
					{scripts}
				</body>
			</html>
		)}
	/>
));
