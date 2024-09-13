/// <reference path="./.sst/platform/config.d.ts" />

import crypto from "node:crypto";
import path from "node:path";

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

		// Derived
		const webSubdomain = $app.stage === "prod" ? "cloud" : `${$app.stage}-web`;
		const manageSubdomain =
			$app.stage === "prod" ? "manage" : `${$app.stage}-manage`;

		// Automatic
		const INTERNAL_DB_SECRET = new random.RandomString("internalDbSecret", {
			length: 16,
		});

		// Defaults
		$transform(sst.aws.Function, (args) => {
			args.architecture ??= "arm64";
		});
		$transform(cloudflare.PagesProject, (args) => {
			if (!args.deploymentConfigs) args.deploymentConfigs = {};
			args.deploymentConfigs = $resolve([args.deploymentConfigs]).apply(
				([cfg]) => {
					if (!cfg.preview) cfg.preview = {};
					if (!cfg.production) cfg.production = {};
					cfg.preview.compatibilityDate ??= "2024-09-12";
					cfg.preview.compatibilityFlags ??= ["nodejs_compat_v2"];
					cfg.production.compatibilityDate ??= "2024-09-12";
					cfg.production.compatibilityFlags ??= ["nodejs_compat_v2"];
					return cfg;
				},
			);
		});

		// MDM Identity Authority
		const identityKey = new tls.PrivateKey("identityKey", {
			algorithm: "ECDSA",
			ecdsaCurve: "P256",
		});

		// TODO: Can we automate renewing this certificate???
		const identityCert = new tls.SelfSignedCert("identityCert", {
			allowedUses: ["cert_signing", "crl_signing"], // TODO: critical: true
			validityPeriodHours: 365 * 24, // 1 year
			privateKeyPem: identityKey.privateKeyPem,
			isCaCertificate: true, // TODO: critical: true
			subject: {
				commonName: "Mattrax Device Authority",
				organization: "Mattax Inc.",
			},
		});

		// `apps/cloud`
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

		// TODO: Remove this
		new command.local.Command(
			"todo",
			{
				create: `echo 'ITS IS DONE' && ls target/lambda && ls target/lambda/lambda && echo '${process.cwd()}'`,
				triggers: [crypto.randomUUID()],
				dir: process.cwd(),
			},
			{
				dependsOn: [cloudBuild],
			},
		);

		const cloudFunction = new sst.aws.Function(
			"cloud",
			{
				...($dev
					? {
							runtime: "nodejs20.x",
							handler: "live.handler",
						}
					: {
							handler: "bootstrap",
							architecture: "arm64",
							runtime: "provided.al2023",
							bundle: path.join(process.cwd(), "target", "lambda", "lambda"),
						}),
				memory: "128 MB",
				environment: {
					DATABASE_URL: DATABASE_URL.value,
					INTERNAL_DB_SECRET: INTERNAL_DB_SECRET.result,
					ENROLLMENT_DOMAIN: renderZoneDomain(zone, webSubdomain),
					MANAGE_DOMAIN: renderZoneDomain(zone, manageSubdomain),
					IDENTITY_CERT: identityCert.certPem,
					IDENTITY_KEY: identityKey.privateKeyPemPkcs8,
					// FEEDBACK_DISCORD_WEBHOOK_URL: discordWebhookUrl.value,
				},
				// TODO: We should probs setup IAM on this???
				url: true,
			},
			{
				dependsOn: [cloudBuild],
			},
		);

		// `apps/web`
		CloudflarePages("web", {
			domain: {
				zone,
				sub: $app.stage === "prod" ? "cloud" : `${$app.stage}-web.dev`,
			},
			// TODO: Also configure domain for `manage`???
			build: {
				command: "pnpm web build",
				output: path.join("apps", "web", "dist"),
				environment: {
					NITRO_PRESET: "cloudflare_pages",
					// TODO: Configure all the environment variables
				},
			},
		});

		// `apps/landing`
		CloudflarePages("landing", {
			domain: {
				zone,
				sub: $app.stage === "prod" ? "@" : `${$app.stage}-landing.dev`,
			},
			build: {
				command: "pnpm landing build",
				output: path.join("apps", "landing", "dist"),
				environment: {
					// DATABASE_URL: INTERNAL_DB_SECRET.result, // TODO
					NITRO_PRESET: "cloudflare_pages",
					// TODO: Make this use the correct domain
					VITE_MATTRAX_CLOUD_ORIGIN: "https://bruh.mattrax.app",
				},
			},
		});

		return {
			todo: cloudFunction.url,
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
			environment?: Record<string, string>;
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
			create: $interpolate`pnpm wrangler pages deploy ${path.join(process.cwd(), opts.build.output)} ${$app.stage !== "prod" ? "--commit-dirty " : ""}--project-name ${site.id}`,
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

	if (opts.domain) {
		new cloudflare.PagesDomain(`${name}Domain`, {
			accountId,
			domain: renderZoneDomain(opts.domain.zone, opts.domain.sub),
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
		// TODO: Return the URL of the preview deployment or prod
	};
}
