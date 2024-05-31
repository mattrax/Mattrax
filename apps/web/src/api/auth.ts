import { DrizzleMySQLAdapter } from "@lucia-auth/adapter-drizzle";
import { cache } from "@solidjs/router";
import { Lucia } from "lucia";
import { appendResponseHeader, getCookie, setCookie } from "vinxi/server";

import { accounts, db, sessions } from "~/db";
import { withEnv } from "~/env";
import type { Features } from "~/lib/featureFlags";

export const lucia = withEnv(() => {
	const adapter = new DrizzleMySQLAdapter(db, sessions, accounts);

	return new Lucia(adapter, {
		sessionCookie: {
			// WARN: Ensure you update the Rust code if you change this
			name: "auth_session",
			attributes: {
				// set to `true` when using HTTPS
				secure: import.meta.env.PROD,
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

	if (sessionId === null) return;

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
			});
		}
	} else {
		appendResponseHeader(
			"Set-Cookie",
			lucia.createBlankSessionCookie().serialize(),
		);
	}

	if (session && account) return { session, account };
}, "checkAuth");
