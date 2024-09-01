/// <reference path="./.sst/platform/config.d.ts" />

import path from "node:path";

// TODO: SST problems:
//  - SSO is broken - workaround: `eval "$(aws configure export-credentials --profile mattrax --format env)"`
//  - SST's assets bucket should have a permission policy that restricts access to the CloudFront distribution to the current AWS account

// TODO: For us:
//  - `sst dev` hooked up
//  - Security HTTP headers using response policy
//  - Configure `www.mattrax.app` redirect using alias + CloudFront function
//  - Quick preview environment for PRs (Eg. using shared resources like CloudFront so it's not stupidly slow)

export default $config({
	app(input) {
		return {
			name: "mattrax",
			removal: input?.stage === "prod" ? "retain" : "remove",
			home: "aws",
			providers: {
				aws: { region: "us-east-1" },
				command: true,
				tls: true,
			},
		};
	},
	async run() {
		// Configuration
		const PRIMARY_DOMAIN =
			$app.stage === "prod"
				? "cloud.mattrax.app"
				: `${$app.stage}.dev.mattrax.app`;
		const MANAGE_DOMAIN =
			$app.stage === "prod"
				? "manage.mattrax.app"
				: `${$app.stage}-manage.dev.mattrax.app`;
		const LANDING_DOMAIN =
			$app.stage === "prod"
				? "mattrax.app"
				: `${$app.stage}-landing.dev.mattrax.app`;

		// Secrets
		// const discordWebhookUrl = new sst.Secret("DiscordWebhookUrl");

		// Defaults
		$transform(
			aws.cloudfront.Distribution,
			(args) => (args.httpVersion = "http2and3"),
		);
		$transform(
			aws.apigatewayv2.Api,
			(args) => (args.disableExecuteApiEndpoint = true),
		);

		// MDM Identity Authority
		const identityKey = new tls.PrivateKey("identityKey", {
			algorithm: "ECDSA",
			ecdsaCurve: "P256",
		});

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

		// `apps/cloud` - Lambda
		const buildCloud = new command.local.Command("buildCloud", {
			create: "./.github/cl.sh build --arm64 --release -p mx-cloud",
			update: "./.github/cl.sh build --arm64 --release -p mx-cloud",
			dir: process.cwd(),
		});

		const api = new sst.aws.Function(
			"api",
			{
				handler: "bootstrap",
				architecture: "arm64",
				runtime: "provided.al2023",
				bundle: path.join("target", "lambda", "mx-cloud"),
				memory: "128 MB",
				environment: {
					PRIMARY_DOMAIN,
					MANAGE_DOMAIN,
					IDENTITY_CERT: identityCert.certPem,
					IDENTITY_KEY: identityKey.privateKeyPemPkcs8,
					// FEEDBACK_DISCORD_WEBHOOK_URL: discordWebhookUrl.value,
				},
				url: {
					authorization: "none", // TODO: Setup "iam",
				},
			},
			{
				dependsOn: [buildCloud],
			},
		);

		const apiOac = new aws.cloudfront.OriginAccessControl(
			"apiOriginAccessControl",
			{
				originAccessControlOriginType: "lambda",
				signingBehavior: "always",
				signingProtocol: "sigv4",
			},
		);

		// `apps/cloud` - API Gateway
		const certsBucket = new sst.aws.Bucket("certs");
		new aws.s3.BucketObject("certPoolFile", {
			bucket: certsBucket.name,
			key: "cert-pool.pem",
			content: identityCert.certPem,
			contentType: "application/x-pem-file",
		});

		new sst.aws.ApiGatewayV2("manage", {
			// domain: MANAGE_DOMAIN,
			transform: {
				domainName: {
					mutualTlsAuthentication: {
						truststoreUri: $interpolate`s3://${certsBucket.name}/cert-pool.pem`,
					},
				},
			},
			// @ts-expect-error // TODO: PR to SST to fix this
		}).routeUrl("$default", api.url);

		// `apps/landing`
		new sst.aws.StaticSite("landing", {
			// domain: LANDING_DOMAIN,
			environment: {
				VITE_MATTRAX_CLOUD_ORIGIN: "https://cloud.mattrax.app",
			},
			build: {
				output: path.join("apps", "landing", ".output", "public"),
				command: "pnpm landing build",
			},
			dev: {
				url: "http://localhost:3001",
				command: "pnpm landing dev",
			},
			assets,
			transform: {
				cdn: (args) => {
					$append(args, "origins", {
						originId: "api",
						domainName: api.url.apply(urlToDomain),
						originPath: "",
						originAccessControlId: apiOac.id,
						customOriginConfig,
					});
					$append(
						args,
						"orderedCacheBehaviors",
						lambdaCacheBehavior("/api/waitlist", "api"),
					);
				},
			},
		});

		// `apps/web`
		new sst.aws.StaticSite("web", {
			// domain: PRIMARY_DOMAIN,
			build: {
				output: path.join("apps", "web", ".output", "public"),
				command: "pnpm web build",
			},
			dev: {
				url: "http://localhost:3000",
				command: "pnpm web dev",
			},
			assets,
			transform: {
				cdn: (args) => {
					$append(args, "origins", {
						originId: "api",
						domainName: api.url.apply(urlToDomain),
						originPath: "",
						originAccessControlId: apiOac.id,
						customOriginConfig,
					});

					$append(
						args,
						"orderedCacheBehaviors",
						lambdaCacheBehavior("/api/*", "api"),
					);
				},
			},
		});
	},
});

const assets: sst.aws.StaticSiteArgs["assets"] = {
	textEncoding: "utf-8",
	fileOptions: [
		{
			files: ["_build/**", "_server/**", "assets/**"],
			cacheControl: "max-age=31536000,public,immutable",
		},
		{
			files: ["favicon.ico", "install.sh", "ogp.png"],
			// 30 mins
			cacheControl: "max-age=1800,public,immutable",
		},
		{
			// TODO: Cloudfront cache in CDN but not client
			files: "**/*",
			cacheControl: "max-age=0,no-cache,no-store,must-revalidate",
		},
	],
};

const customOriginConfig = {
	httpPort: 80,
	httpsPort: 443,
	originProtocolPolicy: "https-only",
	originSslProtocols: ["SSLv3", "TLSv1", "TLSv1.1", "TLSv1.2"],
};

function $append<T, K extends keyof T>(
	args: T,
	key: K,
	value: T[K] extends $util.Input<$util.Input<infer U>[]> | undefined
		? U
		: never,
) {
	// @ts-expect-error
	args[key] = $output(args[key] || []).apply((values) => [value, ...values]);
}

const lambdaCacheBehavior = (pathPattern: string, targetOriginId: string) => ({
	pathPattern,
	targetOriginId,
	allowedMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"],
	cachedMethods: ["GET", "HEAD", "OPTIONS"],
	compress: true,
	viewerProtocolPolicy: "redirect-to-https",
	// CloudFront's managed UseOriginCacheControlHeaders policy
	cachePolicyId: "83da9c7e-98b4-4e11-a168-04f0df8e2c65",
});

const urlToDomain = (s: string) =>
	s.replace(/^https?:\/\//, "").replace(/\/$/, "");
