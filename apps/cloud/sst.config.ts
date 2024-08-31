/// <reference path="./.sst/platform/config.d.ts" />
import { execSync } from "node:child_process";
import path from "node:path";

// TODO: Disable the generation of `sst-env.d.ts`

const enrollmentDomain = "EnterpriseEnrollment.mattrax.cloud";
const managementDomain = "manage.mattrax.cloud";

// TODO: Hook up Cloudflare as DNS provider through SST to automate this
const todoCertificateArn =
	"arn:aws:acm:us-east-1:101829795063:certificate/4c87bd74-87fb-4a07-90bc-5e9c5554d8e8";

export default $config({
	app(input) {
		return {
			name: "mattrax",
			removal: input?.stage === "production" ? "retain" : "remove",
			home: "local", // TODO: "aws",
			providers: {
				aws: { region: "us-east-1" },
				tls: true,
			},
		};
	},
	async run() {
		const discordWebhookUrl = new sst.Secret("DiscordWebhookUrl");

		const identityKey = new tls.PrivateKey("identityKey", {
			algorithm: "ECDSA",
			ecdsaCurve: "P256",
		});

		// TODO: Can we automate renewing this certificate???
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

		const certsBucket = new sst.aws.Bucket("certs");
		new aws.s3.BucketObject("certPoolFile", {
			bucket: certsBucket.name,
			key: "cert-pool.pem",
			content: identityCert.certPem,
			contentType: "application/x-pem-file",
		});

		const api = new sst.aws.ApiGatewayV2("platform", {
			domain: {
				name: enrollmentDomain,

				cert: todoCertificateArn,
				dns: false,
			},
			transform: {
				api: {
					disableExecuteApiEndpoint: true,
				},
			},
		});

		// TODO: By doing this manuallly not within SST's stuff (which doesn't support multiple domains or TLS) the delete fails because it tries to delete `$default` before this is removed
		const manageDomainName = new aws.apigatewayv2.DomainName(
			"managementDomain",
			{
				domainName: managementDomain,
				domainNameConfiguration: {
					certificateArn: todoCertificateArn,
					endpointType: "REGIONAL",
					securityPolicy: "TLS_1_2",
				},
				mutualTlsAuthentication: {
					truststoreUri: $interpolate`s3://${certsBucket.name}/cert-pool.pem`,
				},
			},
		);
		new aws.apigatewayv2.ApiMapping("example", {
			apiId: api.nodes.api.id,
			domainName: manageDomainName.id,
			stage: "$default",
		});

		api.route("$default", {
			...($dev
				? {
						runtime: "nodejs20.x",
						handler: "live.handler",
					}
				: {
						handler: "bootstrap",
						architecture: "arm64",
						runtime: "provided.al2023",
						bundle: build("mx-cloud", "mx-cloud"),
					}),
			memory: "128 MB",
			environment: {
				ENROLLMENT_DOMAIN: enrollmentDomain,
				MANAGE_DOMAIN: managementDomain,
				IDENTITY_CERT: identityCert.certPem,
				IDENTITY_KEY: identityKey.privateKeyPemPkcs8,
				FEEDBACK_DISCORD_WEBHOOK_URL: discordWebhookUrl.value,
			},
		});
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
