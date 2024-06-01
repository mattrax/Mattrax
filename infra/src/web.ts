/// <reference path="../.sst/platform/config.d.ts" />

import type pulumi from "@pulumi/pulumi";

import { domainZone } from "./cloudflare";
import {
	CLOUDFLARE_ACCOUNT,
	CLOUDFLARE_ZONE,
	GITHUB_ORG,
	GITHUB_REPO,
	GITHUB_REPO_BRANCH,
	INTERNAL_SECRET,
	MDM_URL,
	PROD_HOST,
} from "./constants";
import { sesIdentity } from "./email";
import * as entraID from "./entraID";

export function Web() {
	const awsUser = WebAWSUser();

	const pagesProject = WebPagesProject({ awsUser });

	// Without this, requests to /o/* will invoke the worker.
	// We instead rewrite these requests to / so they load index.html from the CDN.
	new cloudflare.Ruleset("MattraxWebSPAIndexRewriteRuleset", {
		kind: "zone",
		name: "default",
		phase: "http_request_transform",
		zoneId: domainZone.id,
		rules: [
			{
				enabled: true,
				action: "rewrite",
				expression: `(http.host eq "${PROD_HOST}" and starts_with(http.request.uri.path, "/o"))`,
				description: "index.html rewrite",
				actionParameters: { uri: { path: { value: "/" } } },
			},
		],
	});

	return { awsUser, pagesProject };
}

function WebAWSUser() {
	const user = new aws.iam.User("MattraxWebIAMUser", {
		name: "mattrax-web-cloudflare",
	});

	new aws.iam.UserPolicy("MattraxWebIAMUserPolicy", {
		name: "SES",
		user: user.name,
		policy: sesIdentity.arn.apply((arn) =>
			aws.iam
				.getPolicyDocument({
					statements: [
						{
							effect: "Allow",
							actions: ["ses:SendEmail"],
							resources: [arn],
						},
					],
				})
				.then((d) => d.json),
		),
	});

	const accessKey = new aws.iam.AccessKey("MattraxWebIAMUserAccessKey", {
		user: user.name,
	});

	return { user, accessKey };
}

function WebPagesProject({
	awsUser,
}: {
	awsUser: ReturnType<typeof WebAWSUser>;
}) {
	const deploymentConfig = {
		compatibilityDate: "2024-04-03",
		compatibilityFlags: ["nodejs_compat", "nodejs_als"],
		link: [awsUser.accessKey, entraID.app, entraID.appPassword],
		environmentVariables: {
			AWS_ACCESS_KEY_ID: awsUser.accessKey.id,
			AWS_SECRET_ACCESS_KEY: awsUser.accessKey.secret,
			ENTRA_CLIENT_ID: entraID.app.clientId,
			ENTRA_CLIENT_SECRET: entraID.appPassword.value,
			AUTH_SECRET: new random.RandomBytes("MattraxWebAuthSecret", {
				length: 64,
			}).base64,
			MDM_URL,
			INTERNAL_SECRET: INTERNAL_SECRET(),
			COOKIE_DOMAIN: CLOUDFLARE_ZONE,
			DATABASE_URL: $interpolate`https://:${INTERNAL_SECRET()}@${MDM_URL}`,
			FROM_ADDRESS: process.env.FROM_ADDRESS ?? "Mattrax <hello@mattrax.app>",
			PNPM_VERSION: "9.0.0",
			STRIPE_PUBLISHABLE_KEY:
				process.env.STRIPE_PUBLISHABLE_KEY ??
				"pk_test_51HWF7EHahv0c3616yp7ja6iTu2EDPzfnvd3cahDGHhPZQMAq8vqXa5QkJquWleLzkRK6KGppESxF8yZwWtBhCJzm00WAqF2c3k",
			STRIPE_SECRET_KEY: new sst.Secret("StripeSecretKey").value,
			FEEDBACK_DISCORD_WEBHOOK_URL: new sst.Secret("FeedbackDiscordWebhookURL")
				.value,
			WAITLIST_DISCORD_WEBHOOK_URL: new sst.Secret("WaitlistDiscordWebhookURL")
				.value,
			PROD_ORIGIN: `https://${PROD_HOST}`,
		},
		failOpen: true,
		placement: { mode: "smart" },
		usageModel: "standard",
	} satisfies PagesProjectDeploymentConfigsProduction;

	const { project } = new PagesProject("MattraxWebWrapperProject", {
		accountId: CLOUDFLARE_ACCOUNT,
		name: "mattrax",
		productionBranch: "main",
		buildConfig: {
			buildCaching: true,
			buildCommand: "pnpm cbuild",
			destinationDir: "dist",
			rootDir: "apps/web",
		},
		deploymentConfigs: {
			preview: deploymentConfig,
			production: deploymentConfig,
		},
		source: {
			config: {
				owner: GITHUB_ORG,
				previewBranchIncludes: ["*"],
				productionBranch: GITHUB_REPO_BRANCH,
				repoName: GITHUB_REPO,
			},
			type: "github",
		},
	});

	new cloudflare.PagesDomain("MattraxWebDomain", {
		accountId: CLOUDFLARE_ACCOUNT,
		projectName: project.name,
		domain: PROD_HOST,
	});

	return project;
}

import { Component } from "../.sst/platform/src/components/component";

interface PagesProjectDeploymentConfigsProduction
	extends cloudflare.types.input.PagesProjectDeploymentConfigsProduction {
	link?: pulumi.Input<any[]>;
}

interface PagesProjectArgs extends cloudflare.PagesProjectArgs {
	deploymentConfigs?: pulumi.Input<{
		preview?: pulumi.Input<PagesProjectDeploymentConfigsProduction>;
		production?: pulumi.Input<PagesProjectDeploymentConfigsProduction>;
	}>;
}

class PagesProject extends Component {
	project: pulumi.Output<cloudflare.PagesProject>;

	constructor(name: string, args: PagesProjectArgs) {
		super("sst:mattrax:cloudflare:PagesProject", name, {}, {});

		const linkData = $output(args.deploymentConfigs)?.apply((c) => {
			return {
				preview: sst.Link.build(c?.preview?.link ?? []),
				production: sst.Link.build(c?.production?.link ?? []),
			};
		});

		this.registerOutputs({
			_receiver: {
				links: $resolve([linkData]).apply(([{ preview, production }]) => {
					return [
						...new Set([
							...preview.map((p) => p.name),
							...production.map((p) => p.name),
						]),
					];
				}),
			},
		});

		this.project = $resolve([linkData]).apply(([linkData]) => {
			args.deploymentConfigs = $output(args.deploymentConfigs).apply(
				(_configs) => {
					const configs = _configs ?? {};

					if (linkData.preview.length > 0) {
						configs.preview ??= {};
						configs.preview.environmentVariables ??= {};

						for (const item of linkData.preview) {
							configs.preview.environmentVariables[
								`SST_RESOURCE_${item.name}`
							] = JSON.stringify(item.properties);
						}

						configs.preview.environmentVariables.SST_RESOURCE_App =
							$jsonStringify({
								app: $app.name,
								stage: $app.stage,
							});

						configs.preview.link = undefined;
					}

					if (linkData.production.length > 0) {
						configs.production ??= {};
						configs.production.environmentVariables ??= {};

						for (const item of linkData.preview) {
							configs.production.environmentVariables[
								`SST_RESOURCE_${item.name}`
							] = JSON.stringify(item.properties);
						}

						configs.production.environmentVariables.SST_RESOURCE_App =
							$jsonStringify({
								app: $app.name,
								stage: $app.stage,
							});

						configs.production.link = undefined;
					}

					return configs;
				},
			);

			return new cloudflare.PagesProject("MattraxWeb", args, {
				protect: true,
			});
		});
	}
}
