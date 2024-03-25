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
				cloudflare: {
					accountId: "f8b7c4b3e3ed4fb3d04a4264e21dd18e",
				},
				aws: {
					region: "us-west-2",
				},
			},
		};
	},
	async run() {
		// Application used for syncing user information from EntraID
		const application = new azuread.Application("Mattrax", {
			displayName: "Mattrax",
			web: {
				redirectUris: [
					"https://cloud.mattrax.app/api/ms/link",
					"https://cloud.mattrax.app/api/enrollment/callback",
				],
			},
		});

		// Used for user uploaded files such as applications
		const bucket = new sst.aws.Bucket("mattrax-data");

		// TODO: SES role binding

		// TODO: Deploy `apps/web` + setup environment variables automatically
	},
});
