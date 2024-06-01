/// <reference path="./.sst/platform/config.d.ts" />

const AWS_REGION = "us-east-1";
export default $config({
	app(input) {
		return {
			name: "mattrax",
			removal: input?.stage === "production" ? "retain" : "remove",
			home: "cloudflare",
			providers: {
				cloudflare: true,
				azuread: true,
				aws: { region: AWS_REGION },
				random: true,
				tailscale: true,
			},
		};
	},
	async run() {
		$linkable(aws.iam.AccessKey, function () {
			return {
				properties: {
					id: this.id,
					secret: this.secret,
				},
			};
		});

		$linkable(azuread.Application, function () {
			return {
				properties: {
					cilentId: this.clientId,
				},
			};
		});

		$linkable(azuread.ApplicationPassword, function () {
			return {
				properties: {
					value: this.value,
				},
			};
		});

		const { Infra } = await import("./src");
		return Infra();
	},
});
