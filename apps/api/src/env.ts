import { createEnv } from "@t3-oss/env-core";
import { getRequestEvent } from "solid-js/web";
import { z } from "zod";

function optionalInDev<T extends z.ZodTypeAny>(
	schema: T,
): z.ZodOptional<T> | T {
	return process.env.NODE_ENV === "development" ? schema.optional() : schema;
}

export const env = withEnv((env) => {
	const runtimeEnv: Record<string, any> = {
		VITE_PROD_ORIGIN: import.meta.env.VITE_PROD_ORIGIN,
		...env,
	};

	return createEnv({
		server: {
			NODE_ENV: z.enum(["development", "production"]).default("development"),
			INTERNAL_SECRET: z.string(),
			DATABASE_URL: z.string(),
			MANAGE_URL: z.string(),

			// Emails
			FROM_ADDRESS: z.string(),
			AWS_ACCESS_KEY_ID: optionalInDev(z.string()),
			AWS_SECRET_ACCESS_KEY: optionalInDev(z.string()),

			// Used for Entra identity provider
			ENTRA_CLIENT_ID: z.string(),
			ENTRA_CLIENT_SECRET: z.string(),

			// Stipe billing
			// STRIPE_PUBLISHABLE_KEY: optionalInDev(z.string()),
			// STRIPE_SECRET_KEY: optionalInDev(z.string()),

			// Tracing
			AXIOM_DATASET: z.string().optional(),
			AXIOM_API_TOKEN: z.string().optional(),

			// Discord webhooks
			WAITLIST_DISCORD_WEBHOOK_URL: z.string().optional(),
			FEEDBACK_DISCORD_WEBHOOK_URL: z.string().optional(),
			DO_THE_THING_WEBHOOK_URL: z.string().optional(),
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

			let result = cache.get(env);
			if (!result) {
				result = fn(env);
				cache.set(env, result);
			}
			return result[prop as keyof T];
		},
	});
}

export type Env = typeof env;
