/// <reference path="../.sst/platform/config.d.ts" />

export const secrets = {
	InternalSecret: new sst.Secret("InternalSecret"),
	StripeSecretKey: new sst.Secret("StripeSecretKey"),
	FeedbackDiscordWebhookURL: new sst.Secret("FeedbackDiscordWebhookURL"),
	WaitlistDiscordWebhookURL: new sst.Secret("WaitlistDiscordWebhookURL"),
	DatabaseURL: new sst.Secret("DatabaseURL"),
	EntraClientID: new sst.Secret("EntraClientID"),
	EntraClientSecret: new sst.Secret("EntraClientSecret"),
};
