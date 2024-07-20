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
		sst.Linkable.wrap(aws.iam.AccessKey, (r) => ({
			properties: { id: r.id, secret: r.secret },
		}));

		sst.Linkable.wrap(azuread.Application, (r) => ({
			properties: { cilentId: r.clientId },
		}));

		sst.Linkable.wrap(azuread.ApplicationPassword, (r) => ({
			properties: { value: r.value },
		}));

		sst.Linkable.wrap(random.RandomBytes, (r) => ({
			properties: { base64: r.base64 },
		}));

		await import("./src");
	},
});
