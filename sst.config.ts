/// <reference path="./.sst/platform/config.d.ts" />

import crypto from "node:crypto";
import path from "node:path";
import type { Env } from "./apps/api/src/env";

if ("CLOUDFLARE_DEFAULT_ACCOUNT_ID" in process.env === false)
	throw new Error("'CLOUDFLARE_DEFAULT_ACCOUNT_ID' is required");
const accountId = process.env.CLOUDFLARE_DEFAULT_ACCOUNT_ID!;

export default $config({
	app: (input) => ({
		name: "mattrax",
		removal: input?.stage === "prod" ? "retain" : "remove",
		home: "cloudflare",
		providers: {
			aws: { region: "us-east-1" },
			cloudflare: true,
			tls: true,
			command: true,
			random: true,
		},
	}),
	async run() {
		// Prerequisites
		const zone = await cloudflare.getZone({
			accountId,
			// mattrax.app
			zoneId: "39b92fff0aea21806fd1b6c6bea628ce",
		});

		// Configuration
		const DATABASE_URL = new sst.Secret("DatabaseURL");
		const ENTRA_CLIENT_ID = new sst.Secret("EntraClientID");
		const ENTRA_CLIENT_SECRET = new sst.Secret("EntraClientSecret");
		const AXIOM_API_TOKEN = new sst.Secret("AxiomApiToken");
		const WAITLIST_DISCORD_WEBHOOK_URL = new sst.Secret(
			"WaitlistDiscordWebhookURL",
		);
		const FEEDBACK_DISCORD_WEBHOOK_URL = new sst.Secret(
			"FeedbackDiscordWebhookURL",
		);
		const DO_THE_THING_WEBHOOK_URL = new sst.Secret("DoTheThingWebhookURL");

		// Derived
		const webSubdomain = $app.stage === "prod" ? "cloud" : `${$app.stage}-web`;
		const manageSubdomain =
			$app.stage === "prod" ? "manage" : `${$app.stage}-manage`;

		// Automatic
		const INTERNAL_SECRET = new random.RandomString("internalSecret", {
			length: 64,
			overrideSpecial: "$-_.+!*'()",
		});

		// Defaults
		$transform(sst.aws.Function, (args) => {
			args.architecture ??= "arm64";
		});
		$transform(cloudflare.WorkerScript, (args) => {
			args.compatibilityDate ??= "2024-09-29";
			args.compatibilityFlags ??= ["nodejs_compat_v2"];
		});
		$transform(cloudflare.PagesProject, (args) => {
			if (!args.deploymentConfigs) args.deploymentConfigs = {};
			args.deploymentConfigs = $resolve([args.deploymentConfigs]).apply(
				([cfg]) => {
					if (!cfg.preview) cfg.preview = {};
					if (!cfg.production) cfg.production = {};
					cfg.preview.compatibilityDate ??= "2024-09-29";
					cfg.preview.compatibilityFlags ??= ["nodejs_compat_v2"];
					cfg.production.compatibilityDate ??= "2024-09-29";
					cfg.production.compatibilityFlags ??= ["nodejs_compat_v2"];
					return cfg;
				},
			);
		});

		// Email
		const email =
			$app.stage !== "prod"
				? sst.aws.Email.get("email", "mattrax.app")
				: new sst.aws.Email("email", {
						sender: "mattrax.app",
						dmarc:
							"v=DMARC1; p=reject; rua=mailto:re+awpujuxug4y@dmarc.postmarkapp.com; adkim=r; aspf=r;",
						dns: sst.cloudflare.dns(),
					});
		const sender = $interpolate`hello@${email.sender}`;

		// Fastmail email
		if ($app.stage === "prod") {
			const cnames = {
				"mesmtp._domainkey.mattrax.app": "mesmtp.mattrax.app.dkim.fmhosted.com",
				"fm1._domainkey": "fm1.mattrax.app.dkim.fmhosted.com",
				"fm2._domainkey": "fm2.mattrax.app.dkim.fmhosted.com",
				"fm3._domainkey": "fm3.mattrax.app.dkim.fmhosted.com",
			};
			const mxs = [
				["in1-smtp.messagingengine.com", 10],
				["in2-smtp.messagingengine.com", 20],
			] as const;
			const txts = [
				"v=spf1 include:spf.messagingengine.com include:amazonses.com -all",
			];

			for (const [name, content] of Object.entries(cnames)) {
				new cloudflare.Record(`CnameRecord${name}`, {
					zoneId: zone.id,
					name: name,
					type: "CNAME",
					content,
					proxied: false,
				});
			}
			for (const [content, priority] of mxs) {
				new cloudflare.Record(`MxRecord${content}`, {
					zoneId: zone.id,
					name: "@",
					type: "MX",
					content,
					priority,
				});
			}
			for (const value of txts) {
				new cloudflare.Record(`TxtRecord${value}`, {
					zoneId: zone.id,
					name: "@",
					type: "TXT",
					content: value,
				});
			}
		}

		// `apps/cloud` - SQL proxy
		const cloudBuild = new command.local.Command("cloudBuild", {
			create:
				"./.github/cl.sh build --arm64 --release -p mx-cloud --bin lambda",
			dir: process.cwd(),
			// TODO: We should be able to ask Nx if the project has changed and only deploy if required.
			triggers: [crypto.randomUUID()],
			environment: {
				CARGO_TERM_COLOR: "always",
			},
		});

		const cloud = new sst.aws.Function(
			"cloud",
			{
				handler: "bootstrap",
				architecture: "arm64",
				runtime: "provided.al2023",
				// SST/Pulumi is having problems with `dependsOn` so we force their hand.
				bundle: cloudBuild.stdout.apply(() =>
					path.join(process.cwd(), "target", "lambda", "lambda"),
				),
				memory: "128 MB",
				environment: {
					DATABASE_URL: DATABASE_URL.value,
					INTERNAL_SECRET: INTERNAL_SECRET.result,
				},
				// TODO: We should probs setup IAM on this???
				url: true,
			},
			{
				dependsOn: [cloudBuild],
			},
		);
		const cloudHost = cloud.url.apply((url) => new URL(url).host);

		// Records for: https://mtls.mattrax.app
		new cloudflare.Record("mtlsCname", {
			zoneId: zone.id,
			name: manageSubdomain,
			type: "CNAME",
			content: "mtls.mattrax.app",
		});
		new cloudflare.Record("mtlsCname", {
			zoneId: zone.id,
			name: manageSubdomain,
			type: "TXT",
			content: "mtls:accept|https://mattrax.app",
		});

		const webUser = new aws.iam.User("web");
		const webAccessKey = new aws.iam.AccessKey("webAccessKey", {
			user: webUser.name,
		});
		const webPolicy = aws.iam.getPolicyDocument({
			statements: [
				{
					effect: "Allow",
					actions: ["ses:SendEmail*"],
					resources: ["*"],
				},
			],
		});
		new aws.iam.UserPolicy("webUserPolicy", {
			name: "webPolicy",
			user: webUser.name,
			policy: webPolicy.then((p) => p.json),
		});

		const VITE_PROD_ORIGIN = `https://${renderZoneDomain(zone, webSubdomain)}`;
		const env: { [K in keyof Env]: $util.Input<Env[K]> } = {
			NODE_ENV: "production",
			INTERNAL_SECRET: INTERNAL_SECRET.result,
			DATABASE_URL: $interpolate`https://:${INTERNAL_SECRET.result}@${cloudHost}`,
			MANAGE_URL: $interpolate`https://${renderZoneDomain(
				zone,
				manageSubdomain,
			)}`,
			FROM_ADDRESS: $interpolate`Mattrax <${sender}>`,
			AWS_ACCESS_KEY_ID: webAccessKey.id,
			AWS_SECRET_ACCESS_KEY: webAccessKey.secret,
			ENTRA_CLIENT_ID: ENTRA_CLIENT_ID.value,
			ENTRA_CLIENT_SECRET: ENTRA_CLIENT_SECRET.value,
			VITE_PROD_ORIGIN,
			WAITLIST_DISCORD_WEBHOOK_URL: WAITLIST_DISCORD_WEBHOOK_URL.value,
			FEEDBACK_DISCORD_WEBHOOK_URL: FEEDBACK_DISCORD_WEBHOOK_URL.value,
			DO_THE_THING_WEBHOOK_URL: DO_THE_THING_WEBHOOK_URL.value,
			AXIOM_API_TOKEN: AXIOM_API_TOKEN.value,
			AXIOM_DATASET: "mattrax",
		};

		const web = CloudflarePages("web", {
			domain: {
				zone,
				sub: $app.stage === "prod" ? "cloud" : `${$app.stage}-web.dev`,
			},
			build: {
				command: "pnpm api build",
				output: path.join("apps", "api", "dist"),
				environment: {
					NITRO_PRESET: "cloudflare_pages",
					NODE_ENV: "production",
					VITE_PROD_ORIGIN,
				},
			},
			site: {
				deploymentConfigs: {
					preview: {
						environmentVariables: env as any,
						placement: {
							mode: "smart",
						},
					},
					production: {
						environmentVariables: env as any,
						placement: {
							mode: "smart",
						},
					},
				},
			},
		});

		// `apps/landing`
		const landing = CloudflarePages("landing", {
			domain: {
				zone,
				sub: $app.stage === "prod" ? "@" : `${$app.stage}-landing.dev`,
			},
			build: {
				command: "pnpm landing build",
				output: path.join("apps", "landing", "dist"),
				environment: {
					NITRO_PRESET: "cloudflare_pages",
					NODE_ENV: "production",
					VITE_MATTRAX_CLOUD_ORIGIN: web.url,
				},
			},
		});

		return {
			cloudApi: cloud.url,
			landing: landing.url,
			web: web.url,
		};
	},
});

const renderZoneDomain = (zone: cloudflare.GetZoneResult, sub: string) =>
	`${sub === "@" ? "" : `${sub}.`}${zone.name}`;

/// A construct which takes care of creating a Cloudflare Pages project and creating an associated deployment.
function CloudflarePages(
	name: string,
	opts: {
		build: {
			command: string;
			output: string;
			environment?: Record<string, $util.Input<string>>;
		};
		site?: Partial<Omit<cloudflare.PagesProjectArgs, "name">>;
		domain?: {
			zone: cloudflare.GetZoneResult;
			sub: string;
		};
		dependsOn?:
			| $util.Input<$util.Input<$util.Resource>[]>
			| $util.Input<$util.Resource>;
	},
) {
	const site = new cloudflare.PagesProject(
		`${name}Site`,
		{
			...opts.site,
			accountId,
			name: $app.stage === "prod" ? name : `${name}-${$app.stage}`,
			productionBranch: opts.site?.productionBranch ?? "main",
		},
		{
			dependsOn: opts.dependsOn,
		},
	);

	// TODO: We only need to deploy when Nx says something changed. Eg. changing landing should skip deploying web.
	const triggers = [crypto.randomUUID()];

	const build = new command.local.Command(
		`${name}Build`,
		{
			create: opts.build.command,
			environment: opts.build.environment,
			dir: process.cwd(),
			triggers,
		},
		{
			dependsOn: opts.dependsOn,
		},
	);

	new command.local.Command(
		`${name}Deploy`,
		{
			create: $interpolate`pnpm wrangler pages deploy ${path.join(
				process.cwd(),
				opts.build.output,
			)} ${$app.stage !== "prod" ? "--commit-dirty " : ""}--project-name ${
				site.id
			}`,
			environment: {
				CLOUDFLARE_DEFAULT_ACCOUNT_ID: accountId,
				CLOUDFLARE_ACCOUNT_ID: accountId,
			},
			dir: process.cwd(),
			triggers,
		},
		{
			dependsOn: [site, build],
		},
	);

	let domain = "";
	if (opts.domain) {
		domain = renderZoneDomain(opts.domain.zone, opts.domain.sub);
		new cloudflare.PagesDomain(`${name}Domain`, {
			accountId,
			domain,
			projectName: site.name,
		});

		new cloudflare.Record(`${name}Record`, {
			zoneId: opts.domain.zone.id,
			name: opts.domain.sub,
			type: "CNAME",
			content: site.subdomain,
			proxied: true,
		});
	}

	// TODO: Cloudflare Access for preview deployments

	return {
		// TODO: Return the URL of the deployment instead of this for development.
		url: `https://${domain}`,
		previewSubdomain: site.subdomain,
	};
}
