/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
	app(input) {
		return {
			name: "mattrax-landing",
			removal: input?.stage === "production" ? "retain" : "remove",
			home: "aws",
			providers: {
				aws: { region: "us-east-1" },
			},
		};
	},
	async run() {
		// TODO: Deploy API function for releases too
		// new sst.aws.StaticSite("landing", {
		// 	build: {
		// 		command: "pnpm build",
		// 	}
		// });
	},
});
