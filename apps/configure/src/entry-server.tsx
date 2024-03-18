// @refresh reload
import { createHandler, StartServer } from "@solidjs/start/server";

export default createHandler(() => (
	<StartServer
		document={({ assets, children, scripts }) => (
			<html lang="en" class="h-full">
				<head>
					<meta charset="utf-8" />
					<meta name="viewport" content="width=device-width, initial-scale=1" />
					<meta name="theme-color" content="#0284C8" />
					<link rel="icon" href="/favicon.ico" />
					<title>Mattrax</title>
					{assets}
				</head>

				<body class="h-full">
					<noscript>
						You need to enable JavaScript to use Mattrax Configure.
					</noscript>
					<div id="app" class="h-full w-full flex">
						{children}
					</div>

					{scripts}
				</body>
			</html>
		)}
	/>
));
