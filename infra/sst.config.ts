/// <reference path="./.sst/platform/config.d.ts" />

import { AWS_REGION } from "./src/constants";

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
		$linkable(aws.iam.AccessKey, (r) => ({
			properties: { id: r.id, secret: r.secret },
		}));

		$linkable(azuread.Application, (r) => ({
			properties: { cilentId: r.clientId },
		}));

		$linkable(azuread.ApplicationPassword, (r) => ({
			properties: { value: r.value },
		}));

		$linkable(random.RandomBytes, (r) => ({
			properties: { base64: r.base64 },
		}));

		await import("./src");
	},
});
