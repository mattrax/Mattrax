import { DrizzlePostgreSQLAdapter } from "@lucia-auth/adapter-drizzle";
import { cache } from "@solidjs/router";
import { Lucia } from "lucia";
import { appendResponseHeader, getCookie, setCookie } from "vinxi/server";

import { accounts, db, sessions } from "~/db";
import { env } from "~/env";
import type { Features } from "~/lib/featureFlags";

const adapter = new DrizzlePostgreSQLAdapter(db, sessions, accounts);

export const lucia = new Lucia(adapter, {
	sessionCookie: {
		attributes: {
			// set to `true` when using HTTPS
			secure: env.NODE_ENV === "production",
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
	}
	if (!session) {
		appendResponseHeader(
			"Set-Cookie",
			lucia.createBlankSessionCookie().serialize(),
		);
	}

	if (session && account) return { session, account };
}, "checkAuth");
