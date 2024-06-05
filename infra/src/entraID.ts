/// <reference path="../.sst/platform/config.d.ts" />

// Application used for syncing user information from EntraID
// WARNING: You must manually setup Publisher verification after deploying this

export const app = new azuread.Application("EntraIDApplication", {
	displayName: "Mattrax",
	marketingUrl: "https://mattrax.app",
	supportUrl: "mailto:hello@mattrax.app",
	// TODO: termsOfServiceUrl
	// TODO: privacyStatementUrl
	featureTags: [
		{
			customSingleSignOn: false,
			enterprise: false,
			gallery: false,
			hide: false,
		},
	],
	requiredResourceAccesses: [
		{
			resourceAccesses: [
				{
					id: "7427e0e9-2fba-42fe-b0c0-848c9e6a8182",
					type: "Scope",
				},
				{
					id: "a8ead177-1889-4546-9387-f25e658e2a79",
					type: "Scope",
				},
				{
					id: "e1fe6dd8-ba31-4d61-89e7-88639da4683d",
					type: "Scope",
				},
				{
					id: "9a5d68dd-52b0-4cc2-bd40-abcf44ac3a30",
					type: "Role",
				},
				{
					id: "dbb9058a-0e50-45d7-ae91-66909b5d4664",
					type: "Role",
				},
				{
					id: "df021288-bdef-4463-88db-98f22de89214",
					type: "Role",
				},
			],
			resourceAppId: "00000003-0000-0000-c000-000000000000",
		},
	],
	signInAudience: "AzureADMultipleOrgs",
	web: {
		redirectUris: [
			"https://cloud.mattrax.app",
			"http://localhost:3000",
		].flatMap((origin) => [
			`${origin}/api/ms/link`,
			`${origin}/enroll/callback`,
		]),
	},
});

export const appPassword = new azuread.ApplicationPassword(
	"EntraIDApplicationPassword",
	{
		applicationId: app.id,
		displayName: "SST Password",
	},
);

new azuread.ApplicationFederatedIdentityCredential(
	"EntraIDGHActionsOIDCCredential",
	{
		applicationId: app.id,
		displayName: "gh-actions-oidc",
		audiences: ["api://AzureADTokenExchange"],
		issuer: "https://token.actions.githubusercontent.com",
		subject: "repo:mattrax/Mattrax:environment:production",
	},
);

new azuread.ServicePrincipal("EntraIDServicePrincipal", {
	clientId: app.clientId,
	featureTags: [{ enterprise: true }],
});
