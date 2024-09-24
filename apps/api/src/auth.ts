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
import { withEnv } from "~/env";

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
		}),
		getSessionAttributes: (data) => ({}),
	});
});

declare module "lucia" {
	interface Register {
		Lucia: typeof lucia;
		DatabaseUserAttributes: DatabaseUserAttributes;
		DatabaseSessionAttributes: DatabaseSessionAttributes;
	}
}

export interface DatabaseUserAttributes {
	pk: number;
	id: string;
	email: string;
	name: string;
}

type DatabaseSessionAttributes = Record<string, never>;

export const checkAuth = cache(async () => {
	const sessionId = getCookie(lucia.sessionCookieName) ?? null;

	if (sessionId === null) {
		if (getCookie("isLoggedIn") !== undefined)
			deleteCookie(getRequestEvent()!.nativeEvent, "isLoggedIn", {
				httpOnly: false,
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
			});
		}
	} else {
		appendResponseHeader(
			"Set-Cookie",
			lucia.createBlankSessionCookie().serialize(),
		);
		deleteCookie(getRequestEvent()!.nativeEvent, "isLoggedIn", {
			httpOnly: false,
		});
	}

	if (session && account) return { session, account };
}, "checkAuth");

export function setIsLoggedInCookie() {
	setCookie("isLoggedIn", "true", {
		httpOnly: false,
	});
}
