import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

function optional_in_dev<T extends z.ZodTypeAny>(
	schema: T,
): z.ZodOptional<T> | T {
	return process.env.NODE_ENV === "development" ? schema.optional() : schema;
}

export const env = createEnv({
	server: {
		// Used to secure the session for the dashboard
		AUTH_SECRET: z.string(),
		// Used to secure the JWT's used for MDM authentication
		// This is shared with Rust so both sides can sign/verify JWT's
		//
		// This token is also used to authenticate `apps/web` with the Rust code when making HTTP requests
		INTERNAL_SECRET: z.string(),
		DATABASE_URL: z.string(),
		PROD_ORIGIN: z.string(),
		FROM_ADDRESS: z.string(),
		// Emails and other AWS services
		// Get these values from the output of the Cloudformation template
		AWS_ACCESS_KEY_ID: optional_in_dev(z.string()),
		AWS_SECRET_ACCESS_KEY: optional_in_dev(z.string()),
		// Stipe billing
		STRIPE_PUBLISHABLE_KEY: z.string(),
		STRIPE_SECRET_KEY: z.string(),
		// Used for syncing users from Entra to Mattrax
		ENTRA_CLIENT_ID: z.string(),
		ENTRA_CLIENT_SECRET: z.string(),
		NODE_ENV: z.enum(["development", "production"]).default("development"),
		FEEDBACK_DISCORD_WEBHOOK_URL: z.string().optional(),
		WAITLIST_DISCORD_WEBHOOK_URL: z.string().optional(),
	},
	clientPrefix: "VITE_",
	client: {},
	// We need to manually list the env's for the frontend bundle
	runtimeEnv: process.env,
	skipValidation: process.env.SKIP_ENV_VALIDATION === "true",
	emptyStringAsUndefined: true,
});
