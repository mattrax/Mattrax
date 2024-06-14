import { createEnv } from "@t3-oss/env-core";
import { getRequestEvent } from "solid-js/web";
import { Resource } from "sst";
import { z } from "zod";

function optionalInDev<T extends z.ZodTypeAny>(
	schema: T,
): z.ZodOptional<T> | T {
	return process.env.NODE_ENV === "development" ? schema.optional() : schema;
}

export const env = withEnv((env) => {
	// we're in an sst cloud environment
	const isSSTEnvironment = "SST_RESOURCE_App" in env;

	let runtimeEnv: Record<string, any> = {
		VITE_PROD_ORIGIN: import.meta.env.VITE_PROD_ORIGIN,
		...env,
	};

	if (typeof document === "undefined" && isSSTEnvironment) {
		runtimeEnv = {
			...runtimeEnv,
			INTERNAL_SECRET: Resource.InternalSecret.value,
			AWS_ACCESS_KEY_ID: Resource.MattraxWebIAMUserAccessKey.id,
			AWS_SECRET_ACCESS_KEY: Resource.MattraxWebIAMUserAccessKey.secret,
			ENTRA_CLIENT_ID: Resource.EntraClientID.value,
			ENTRA_CLIENT_SECRET: Resource.EntraClientSecret.value,
			STRIPE_SECRET_KEY: Resource.StripeSecretKey.value,
		};
	}

	return createEnv({
		server: {
			// Used to secure the JWT's used for MDM authentication
			// This is shared with Rust so both sides can sign/verify JWT's
			//
			// This token is also used to authenticate `apps/web` with the Rust code when making HTTP requests
			INTERNAL_SECRET: z.string(),
			DATABASE_URL: z.string(),
			MDM_URL: z.string(),
			ENTERPRISE_ENROLLMENT_URL: z.string(),
			FROM_ADDRESS: z.string(),
			NODE_ENV: z.enum(["development", "production"]).default("development"),
			// Emails and other AWS services
			AWS_ACCESS_KEY_ID: optionalInDev(z.string()),
			AWS_SECRET_ACCESS_KEY: optionalInDev(z.string()),
			// Used for syncing users from Entra to Mattrax
			ENTRA_CLIENT_ID: z.string(),
			ENTRA_CLIENT_SECRET: z.string(),
			// Stipe billing
			STRIPE_PUBLISHABLE_KEY: optionalInDev(z.string()),
			STRIPE_SECRET_KEY: optionalInDev(z.string()),

			// Environment variables for Mattrax Cloud
			// Do not use these unless you know what your doing
			COOKIE_DOMAIN: z.string().optional(),
		},
		clientPrefix: "VITE_",
		client: {
			VITE_PROD_ORIGIN: z.string(),
		},
		runtimeEnv,
		skipValidation: env.SKIP_ENV_VALIDATION === "true",
		emptyStringAsUndefined: true,
	});
});

/// Cloudflare only exposes environment variables within the context of a request so this functions help with that.
///
/// The result will be cached as long as the same environment variables are provided by Cloudflare.
export function withEnv<T extends object>(
	fn: (e: { [key: string]: any | undefined }) => T,
): T {
	// If we are on the client we use the values in the bundle
	if ("window" in globalThis) return fn({});

	const cache = new Map();

	return new Proxy({} as any, {
		get(_, prop) {
			const event = getRequestEvent();
			if (!event && process.env?.DRIZZLE !== "1")
				throw new Error(
					"Attempted to access `withEnv` value outside of a request context",
				);

			const env = event?.nativeEvent?.context?.cloudflare?.env ?? process.env;

			// const url = event?.request.url ? new URL(event.request.url) : null;

			// const isPreviewEnv = url?.host?.endsWith(".mattrax-bdc.pages.dev");

			// // We do it this way to break reference equality if it changes for the cache
			// env = isPreviewEnv && url ? { ...env, PROD_URL: url.origin } : env;

			env.PROD_URL = "https://otbeaumont.me"; // TODO

			let result = cache.get(env);
			if (!result) {
				result = fn(env);
				cache.set(env, result);
			}
			return result[prop as keyof T];
		},
	});
}
