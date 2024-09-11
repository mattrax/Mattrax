/// <reference path="./.sst/platform/config.d.ts" />

// const secrets = {};

export default $config({
	app(input) {
		return {
			name: "mattrax",
			removal: input?.stage === "prod" ? "retain" : "remove",
			home: "local", // TODO: Moved to Cloudflare
			providers: {
				cloudflare: true,
				aws: { region: "us-east-1" },
				command: true,
				tls: true,
			},
		};
	},
	async run() {
		const accountId = process.env.CLOUDFLARE_DEFAULT_ACCOUNT_ID;
		if (!accountId)
			throw new Error("'CLOUDFLARE_DEFAULT_ACCOUNT_ID' is required");

		// Email
		// const email = new sst.aws.Email("email", {
		// 	sender: "hello@mattrax.app",
		// });

		// MDM backend
		// TODO
		// `apps/cloud` - Lambda
		// TODO: Use `triggers` so that we only run this when the backend changes??? -> but that breaks the whole deployment system so idk.
		// const buildCloud = new command.local.Command("buildCloud", {
		// 	create: "./.github/cl.sh build --arm64 --release -p mx-cloud",
		// 	update: "./.github/cl.sh build --arm64 --release -p mx-cloud",
		// 	dir: process.cwd(),
		// 	environment: {
		// 		CARGO_TERM_COLOR: "always",
		// 	},
		// });

		// const api = new sst.aws.Function(
		// 	"api",
		// 	{
		// 		handler: "bootstrap",
		// 		architecture: "arm64",
		// 		runtime: "provided.al2023",
		// 		bundle: path.join(process.cwd(), "target", "lambda", "mx-cloud"),
		// 		memory: "128 MB",
		// 		environment: {
		// 			PRIMARY_DOMAIN,
		// 			MANAGE_DOMAIN,
		// 			IDENTITY_CERT: identityCert.certPem,
		// 			IDENTITY_KEY: identityKey.privateKeyPemPkcs8,
		// 			FEEDBACK_DISCORD_WEBHOOK_URL: feedbackDiscordWebhookUrl.value,
		// 			WAITLIST_DISCORD_WEBHOOK_URL: waitlistDiscordWebhookUrl.value,
		// 		},
		// 		url: {
		// 			authorization: "none", // TODO: Setup "iam",
		// 		},
		// 	},
		// 	{
		// 		dependsOn: [buildCloud],
		// 	},
		// );

		// Landing
		// new sst.cloudflare.StaticSite("todo", {
		// 	// domain: PRIMARY_DOMAIN,
		// 	// build: {
		// 	// 	output: path.join("apps", "web", ".output", "public"),
		// 	// 	command: "pnpm web build",
		// 	// },
		// 	// dev: {
		// 	// 	url: "http://localhost:3000",
		// 	// 	command: "pnpm web dev",
		// 	// },
		// 	path: "./public",
		// 	// TODO: Run build
		// 	// TODO: Configure DNS
		// 	// TODO: SST dev setup
		// });

		const page = new cloudflare.PagesProject("api", {
			name: "todo", // TODO: Stage name
			accountId,
			productionBranch: "main",
		});

		// TODO: Run when assets change?
		new command.local.Command(
			"deploy",
			{
				// TODO: `--commit-hash todo --commit-message todo --commit-dirty`
				// TODO: `--branch main` from stage name???
				// TODO: Preview vs Production deployment -> Is it derived from `branch`???
				create: $interpolate`wrangler pages deploy ./public --project-name ${page.id}`,
				// TODO: Setup `triggers` -> The filesystem input probs
				// update: $interpolate`wrangler pages deploy ./public --project-name ${page.id}`,
				environment: {
					CLOUDFLARE_DEFAULT_ACCOUNT_ID: "f02b3ef168fe64129e9941b4fb2e4dc1",
					CLOUDFLARE_ACCOUNT_ID: "f02b3ef168fe64129e9941b4fb2e4dc1",
					CLOUDFLARE_API_TOKEN: "wtvy3nt-7CHUZ-AHnWtcCuXayKDNrxwyOWOMZjDR",
				},
				dir: process.cwd(),
			},
			{
				dependsOn: page,
			},
		);

		// Web
		// TODO: Linking with MDM backend
	},
});
