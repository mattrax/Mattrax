import { DrizzleMySQLAdapter } from "@lucia-auth/adapter-drizzle";
import { cache } from "@solidjs/router";
import { Lucia } from "lucia";
import { getRequestEvent } from "solid-js/web";
import {
	appendResponseHeader,
	deleteCookie,
	getCookie,
	setCookie,
} from "vinxi/server";

import { accounts, db, sessions } from "~/db";
import { env } from "~/env";
import type { Features } from "~/lib/featureFlags";

export const lucia = withAuth((domain) => {
	const adapter = new DrizzleMySQLAdapter(db, sessions, accounts);

	return new Lucia(adapter, {
		sessionCookie: {
			// WARN: Ensure you update the Rust code if you change this
			name: "auth_session",
			attributes: {
				// set to `true` when using HTTPS
				secure: import.meta.env.PROD,
				domain,
			},
		},
		getUserAttributes: (data) => ({
			pk: data.pk,
			id: data.id,
			email: data.email,
			name: data.name,
			features: data.features,
		}),
		getSessionAttributes: (data) => ({
			userAgent: data.userAgent,
			location: data.location,
		}),
	});
});

declare module "lucia" {
	interface Register {
		Lucia: typeof lucia;
		DatabaseUserAttributes: DatabaseUserAttributes;
		DatabaseSessionAttributes: DatabaseSessionAttributes;
	}
}

interface DatabaseUserAttributes {
	pk: number;
	id: string;
	email: string;
	name: string;
	features: Features[];
}

interface DatabaseSessionAttributes {
	// Web or CLI session
	userAgent: `${"w" | "c"}${string}`;
	location: string;
}

export const checkAuth = cache(async () => {
	"use server";

	const sessionId = getCookie(lucia.sessionCookieName) ?? null;

	if (sessionId === null) {
		if (getCookie("isLoggedIn") !== undefined)
			deleteCookie(getRequestEvent()!.nativeEvent, "isLoggedIn", {
				httpOnly: false,
				domain: env.COOKIE_DOMAIN,
			});

		return;
	}

	const { session, user: account } = await lucia.validateSession(sessionId);

	if (session) {
		if (session.fresh)
			appendResponseHeader(
				"Set-Cookie",
				lucia.createSessionCookie(session.id).serialize(),
			);

		if (getCookie("isLoggedIn") === undefined) {
			setCookie("isLoggedIn", "true", {
				httpOnly: false,
				domain: env.COOKIE_DOMAIN,
			});
		}
	} else {
		appendResponseHeader(
			"Set-Cookie",
			lucia.createBlankSessionCookie().serialize(),
		);
		deleteCookie(getRequestEvent()!.nativeEvent, "isLoggedIn", {
			httpOnly: false,
			domain: env.COOKIE_DOMAIN,
		});
	}

	if (session && account) return { session, account };
}, "checkAuth");

/// Cache the auth instance based on the incoming request's URL.
///
/// This is so we can properly account for preview deployments, while setting the cookie to `mattrax.app` in prod.
function withAuth<T extends object>(fn: (domain: string | undefined) => T): T {
	const cache = new Map();

	return new Proxy({} as any, {
		get(_, prop) {
			const event = getRequestEvent();
			if (!event)
				throw new Error(
					"Attempted to access `withAuth` value outside of a request context",
				);

			const url = new URL(event.request.url);
			let domain = env.COOKIE_DOMAIN;
			if (
				env.PREVIEW_DOMAIN_SUFFIX &&
				url.hostname.includes(env.PREVIEW_DOMAIN_SUFFIX)
			) {
				domain = undefined;
			}

			let result = cache.get(domain);
			if (!result) {
				result = fn(domain);
				cache.set(domain, result);
			}
			return result[prop as keyof T];
		},
	});
}
