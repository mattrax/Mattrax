// @refresh reload
import { StartServer, createHandler } from "@solidjs/start/server";

export default createHandler(
	() => (
		<StartServer
			document={({ assets, children, scripts }) => (
				<html lang="en">
					<head>
						<meta charset="utf-8" />
						<meta
							name="viewport"
							content="width=device-width, initial-scale=1"
						/>
						<link rel="icon" href="/favicon.ico" />
						<title>Mattrax</title>
						<meta
							name="description"
							content="Open-source mobile device management solution with support for Windows, Apple, and Android devices."
						/>
						<meta property="og:image" content="/ogp.png" />

						{assets}
					</head>
					<body>
						<div id="app">{children}</div>
						{scripts}
					</body>
				</html>
			)}
		/>
	),
	() => ({ mode: "async" }),
);
