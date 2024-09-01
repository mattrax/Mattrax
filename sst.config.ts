/// <reference path="./.sst/platform/config.d.ts" />

import { execSync } from "node:child_process";
import path from "node:path";

export default $config({
	app(input) {
		return {
			name: "mattrax",
			removal: input?.stage === "prod" ? "retain" : "remove",
			home: "aws",
			providers: {
				aws: { region: "us-east-1" },
				// cloudflare: input.stage === "prod" ? {} : undefined,
				"synced-folder": true,
			},
		};
	},
	async run() {
		const assetsBucketName = `${$app.name}-assets`;
		const assetsBucket =
			$app.stage === "prod"
				? new sst.aws.Bucket("assets", {
						transform: {
							bucket: {
								bucket: assetsBucketName,
							},
						},
						// TODO: Cloudfront access policy
					})
				: sst.aws.Bucket.get("assets", assetsBucketName);

		// new syncedfolder.S3BucketFolder(
		// 	"synced-folder",
		// 	{
		// 		path: "./apps/landing/.output/public",
		// 		bucketName: assetsBucket.name,
		// 		acl: aws.s3.AuthentikcatedReadAcl,
		// 		// TODO: Prefix the files within the bucket
		// 		// TODO: Cache control
		// 	},
		// 	{
		// 		dependsOn: [], // TODO: Building landing
		// 	},
		// );
		// TODO: Build and upload web interface assets
		// TODO: All the TLS certs and stuff
		// const api = new sst.aws.Function("api", {
		// 	handler: "bootstrap",
		// 	architecture: "arm64",
		// 	runtime: "provided.al2023",
		// 	bundle: build("mx-cloud", "mx-cloud"),
		// 	memory: "128 MB",
		// 	environment: {
		// 		// ENROLLMENT_DOMAIN: enrollmentDomain,
		// 		// MANAGE_DOMAIN: managementDomain,
		// 		// IDENTITY_CERT: identityCert.certPem,
		// 		// IDENTITY_KEY: identityKey.privateKeyPemPkcs8,
		// 		// FEEDBACK_DISCORD_WEBHOOK_URL: discordWebhookUrl.value,
		// 	},
		// });
		// TODO: Security HTTP headers using Cloudfront Function???
		// new sst.aws.Cdn("cloud", {
		// 	// domain: {
		// 	// 	name: "cloud.mattrax.com",
		// 	// 	dns: sst.cloudflare.dns(),
		// 	// },
		// 	origins: [
		// 		// {
		// 		// 	domainName: assetsBucket.arn,
		// 		// },
		// 	],
		// 	orderedCacheBehaviors: [
		// 		// `/api` & `/EnrollmentServer` to Rust stuff
		// 	],
		// 	defaultCacheBehavior: {
		// 		// TODO: Proper caching rules (including specially for Vite stuff vs html)
		// 		allowedMethods: ["GET", "HEAD", "OPTIONS"], // TODO: Them all
		// 		cachedMethods: ["GET", "HEAD", "OPTIONS"], // TODO: Them all
		// 		targetOriginId: "todo",
		// 		viewerProtocolPolicy: "redirect-to-https",
		// 	},
		// 	// defaultRootObject
		// });
		// TODO: API gateway for `manage.mattrax.app`
		// TODO: Landing CDN
		// TODO: - Waitlist in Rust w/ Besu and routing to it
		// TODO: - Including proxy for install script & waitlist
	},
});
function build(target: string, bin: string) {
	// TODO: Do `async` so this isn't deploying deploying other stuff
	execSync(
		`cargo lambda build --arm64 --release --bin lambda -p ${target} --bin ${bin}`,
		{
			cwd: path.join(process.cwd(), ".."),
		},
	);
	return path.join(process.cwd(), "..", "..", "..", "target", "lambda", bin);
}
