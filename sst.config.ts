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
		home: "local", // TODO: cloudflare
		providers: {
			aws: { region: "us-east-1" },
			cloudflare: true,
			tls: true,
			command: true,
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

		// `apps/cloud`
		// `apps/web`
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
					NITRO_PRESET: "cloudflare_pages",
					// TODO: Make this use the correct domain
					VITE_MATTRAX_CLOUD_ORIGIN: "https://bruh.mattrax.app",
				},
			},
			// site: {
			// 	deploymentConfigs: {
			// 		production: {
			// 			environmentVariables: {},
			// 		},
			// 		preview: {
			// 			environmentVariables: {},
			// 		},
			// 	},
			// },
		});
	},
});

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
	const replaceOnChanges = ["*"];

	const build = new command.local.Command(
		`${name}Build`,
		{
			create: opts.build.command,
			environment: opts.build.environment,
			dir: process.cwd(),
			triggers: [crypto.randomUUID()],
		},
		{
			replaceOnChanges,
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
			triggers: [crypto.randomUUID()],
		},
		{
			dependsOn: [site, build],
			replaceOnChanges,
		},
	);

	if (opts.domain) {
		new cloudflare.PagesDomain(`${name}Domain`, {
			accountId,
			domain: `${opts.domain.sub === "@" ? "" : `${opts.domain.sub}.`}${opts.domain.zone.name}`,
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
