import { DrizzleMySQLAdapter } from "@lucia-auth/adapter-drizzle";
import { Lucia } from "lucia";
import {
	type HTTPEvent,
	appendResponseHeader,
	getCookie,
	setCookie,
} from "vinxi/server";

import { accounts, db, sessions } from "~/db";
import { env } from "~/env";
import type { Features } from "~/lib/featureFlags";

const adapter = new DrizzleMySQLAdapter(db, sessions, accounts);

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
});

declare module "lucia" {
	interface Register {
		Lucia: typeof lucia;
		DatabaseUserAttributes: DatabaseUserAttributes;
	}
}

interface DatabaseUserAttributes {
	pk: number;
	id: string;
	email: string;
	name: string;
	features: Features[];
}

export async function checkAuth(event: HTTPEvent) {
	const sessionId = getCookie(event, lucia.sessionCookieName) ?? null;

	if (sessionId === null) return;

	const { session, user: account } = await lucia.validateSession(sessionId);

	if (session) {
		if (session.fresh)
			appendResponseHeader(
				event,
				"Set-Cookie",
				lucia.createSessionCookie(session.id).serialize(),
			);

		if (getCookie(event, "isLoggedIn") === undefined) {
			setCookie(event, "isLoggedIn", "true", {
				httpOnly: false,
			});
		}
	}
	if (!session) {
		appendResponseHeader(
			event,
			"Set-Cookie",
			lucia.createBlankSessionCookie().serialize(),
		);
	}

	if (session && account) return { session, account };
}
