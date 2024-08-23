/// <reference path="./.sst/platform/config.d.ts" />

import { execSync } from "node:child_process";
import path from "node:path";

// TODO: Disable the generation of `sst-env.d.ts`
// TODO: Rust build colors for Live Lambda
// TODO: Live Lambda stop reload loop on error?

export default $config({
	app(input) {
		return {
			name: "sst",
			removal: input?.stage === "production" ? "retain" : "remove",
			home: "aws",
		};
	},
	async run() {
		new sst.aws.Function("api", {
			...($dev
				? {
						runtime: "nodejs20.x",
						handler: "live.handler",
					}
				: {
						handler: "bootstrap",
						architecture: "arm64",
						runtime: "provided.al2023",
						bundle: build("mattrax-platform", "lambda"),
					}),
			memory: "128 MB",
			environment: {
				ENROLLMENT_DOMAIN: "playground.otbeaumont.me",
				MANAGE_DOMAIN: "playground2.otbeaumont.me",
				// TODO: Generate these via SST and keep out of Git. These are temporary credentials so fine in Git.
				IDENTITY_CERT:
					"MIIBsTCCAVagAwIBAgIUdwFZTA91aMlbzW6jH3fdT3okJt4wCgYIKoZIzj0EAwIwNTEhMB8GA1UEAwwYTWF0dHJheCBEZXZpY2UgQXV0aG9yaXR5MRAwDgYDVQQKDAdNYXR0cmF4MCAXDTc1MDEwMTAwMDAwMFoYDzQwOTYwMTAxMDAwMDAwWjA1MSEwHwYDVQQDDBhNYXR0cmF4IERldmljZSBBdXRob3JpdHkxEDAOBgNVBAoMB01hdHRyYXgwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAAScQxiO9VKUdq/d6dqVXdPwYPilQQmY8jz7zF83CicnWz/vgQG3fnIJXmwG3TCTMgLb14Om4FVW1axsfJzYEsmpo0IwQDAOBgNVHQ8BAf8EBAMCAQYwHQYDVR0OBBYEFJU1BUYRyEZY8MvASh71dYtwfjpwMA8GA1UdEwEB/wQFMAMBAf8wCgYIKoZIzj0EAwIDSQAwRgIhAMNrLWK8qnUwgY2WXHIOgCaTKWwPaAKvKCVYdnY1LlI+AiEA35USSFoMX/rCZuBqdm0OaEfZXYGY171vo0PKOOM63qc=",
				IDENTITY_KEY:
					"MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgd7OyrV0EFbGOp1iVftj5RGymn2dC6Tck6DW6SCGHRzuhRANCAAScQxiO9VKUdq/d6dqVXdPwYPilQQmY8jz7zF83CicnWz/vgQG3fnIJXmwG3TCTMgLb14Om4FVW1axsfJzYEsmp",
			},
		});

		// TODO: Setup API Gateway
	},
});

function build(target: string, bin: string) {
	execSync(
		`cargo lambda build --arm64 --release --bin lambda -p ${target} --bin ${bin}`,
		{
			cwd: path.join(process.cwd(), ".."),
		},
	);
	return path.join(process.cwd(), "..", "..", "..", "target", "lambda", bin);
}
