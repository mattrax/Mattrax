/// <reference path="./.sst/platform/config.d.ts" />

import * as aws from "@pulumi/aws";
import * as azuread from "@pulumi/azuread";

export default $config({
	app(input) {
		return {
			name: "mattrax",
			removal: input?.stage === "production" ? "retain" : "remove",
			home: "aws",
			providers: {
				// cloudflare: {
				// 	accountId: "f8b7c4b3e3ed4fb3d04a4264e21dd18e",
				// },
				aws: {
					region: "us-west-2",
				},
			},
		};
	},
	async run() {
		// Application used for syncing user information from EntraID
		// WARNING: You must manually setup Publisher verification after deploying this
		const application = new azuread.Application(
			"Mattrax",
			{
				displayName: "Mattrax",
				// TODO: Logo
				// TODO: Home page URL - https://mattrax.app
				// TODO: Terms of service URL - TODO
				// TODO: Publisher domain
				// TODO: Accounts in any organizational directory

				web: {
					redirectUris: [
						"https://cloud.mattrax.app/api/ms/link",
						"https://cloud.mattrax.app/api/enrollment/callback",
					],
				},
			},
			{
				// After publisher verification we probs don't want this to just disappear
				retainOnDelete: true,
			},
		);

		// // Used for user uploaded files such as applications
		// const bucket = new sst.aws.Bucket("mattrax-data");

		// TODO: SES role binding

		// TODO: Deploy `apps/web` + setup environment variables automatically
	},
});
