import { createEnv } from "@t3-oss/env-core";
import { getRequestEvent } from "solid-js/web";
import { z } from "zod";
import { Resource } from "sst";

function optional_in_dev<T extends z.ZodTypeAny>(
	schema: T,
): z.ZodOptional<T> | T {
	return process.env.NODE_ENV === "development" ? schema.optional() : schema;
}

export const env = withEnv((env) =>
	createEnv({
		server: {
			// Used to secure the JWT's used for MDM authentication
			// This is shared with Rust so both sides can sign/verify JWT's
			//
			// This token is also used to authenticate `apps/web` with the Rust code when making HTTP requests
			INTERNAL_SECRET: z.string(),
			DATABASE_URL: z.string(),
			PROD_ORIGIN: z.string(),
			MDM_URL: z.string(),
			FROM_ADDRESS: z.string(),
			// Emails and other AWS services
			// Get these values from the output of the Cloudformation template
			AWS_ACCESS_KEY_ID: optional_in_dev(z.string()),
			AWS_SECRET_ACCESS_KEY: optional_in_dev(z.string()),
			// Stipe billing
			STRIPE_PUBLISHABLE_KEY: optional_in_dev(z.string()),
			STRIPE_SECRET_KEY: optional_in_dev(z.string()),
			// Used for syncing users from Entra to Mattrax
			ENTRA_CLIENT_ID: z.string(),
			ENTRA_CLIENT_SECRET: z.string(),
			NODE_ENV: z.enum(["development", "production"]).default("development"),

			// Environment variables for Mattrax Cloud
			// Do not use these unless you know what your doing
			COOKIE_DOMAIN: z.string().optional(),
		},
		clientPrefix: "VITE_",
		client: {},
		runtimeEnv: process.env,
		skipValidation: process.env.SKIP_ENV_VALIDATION === "true",
		emptyStringAsUndefined: true,
	}),
);

export function getInternalSecret() {
	if (Resource.InternalSecret) return Resource.InternalSecret.value;

	return env.INTERNAL_SECRET;
}

/// Cloudflare only exposes environment variables within the context of a request so this functions help with that.
///
/// The result will be cached as long as the same environment variables are provided by Cloudflare.
export function withEnv<T extends object>(
	fn: (e: { [key: string]: any | undefined }) => T,
): T {
	// If we are on the client we use the values in the bundle
	if ("window" in globalThis)
		return fn({
			// We need to manually list all the env variables we want to use in the client
		});

	const cache = new Map();

	return new Proxy({} as any, {
		get(_, prop) {
			const event = getRequestEvent();
			if (!event && process.env?.DRIZZLE !== "1")
				throw new Error(
					"Attempted to access `withEnv` value outside of a request context",
				);

			const env = event?.nativeEvent?.context?.cloudflare?.env ?? process.env;

			let result = cache.get(env);
			if (!result) {
				result = fn(env);
				cache.set(env, result);
			}
			return result[prop as keyof T];
		},
	});
}
