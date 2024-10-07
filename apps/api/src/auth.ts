import { DrizzleMySQLAdapter } from "@lucia-auth/adapter-drizzle";
import { cache } from "@solidjs/router";
import {
	deleteCookie,
	getCookie,
	getSignedCookie,
	setCookie,
	setSignedCookie,
} from "hono/cookie";
import { Lucia } from "lucia";

import { getRequestEvent } from "solid-js/web";
import { accounts, db, sessions } from "~/db";
import { env, withEnv } from "~/env";

export const lucia = withEnv(() => {
	const adapter = new DrizzleMySQLAdapter(db, sessions, accounts);

	return new Lucia(adapter, {
		sessionCookie: {
			name: "session",
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
	const req = getRequestEvent()!;
	if (!req) throw new Error("No request event");
	const sessionId = await getSignedCookie(
		req.hono,
		env.INTERNAL_SECRET,
		lucia.sessionCookieName,
	);

	if (!sessionId) {
		if (getCookie(req.hono, "isLoggedIn") !== undefined)
			deleteCookie(req.hono, "isLoggedIn", {
				...lucia.createBlankSessionCookie().attributes,
				httpOnly: false,
			});

		return;
	}

	const { session, user: account } = await lucia.validateSession(sessionId);

	if (session) {
		const cookie = lucia.createSessionCookie(session.id);
		if (session.fresh) {
			await setSignedCookie(
				req.hono,
				cookie.name,
				cookie.value,
				env.INTERNAL_SECRET,
				cookie.attributes,
			);
		}

		if (getCookie(req.hono, "isLoggedIn") === undefined) {
			setCookie(req.hono, "isLoggedIn", "true", {
				...cookie.attributes,
				httpOnly: false,
			});
		}
	} else {
		const cookie = lucia.createBlankSessionCookie();
		deleteCookie(req.hono, cookie.name, cookie.attributes);
		deleteCookie(req.hono, "isLoggedIn", {
			...cookie.attributes,
			httpOnly: false,
		});
	}

	if (session && account) return { session, account };
}, "checkAuth");

export async function createSession(accountId: string) {
	const req = getRequestEvent();
	if (!req) throw new Error("No request event");

	const session = await lucia.createSession(accountId, {});
	const cookie = lucia.createSessionCookie(session.id);
	await setSignedCookie(
		req.hono,
		cookie.name,
		cookie.value,
		env.INTERNAL_SECRET,
		cookie.attributes,
	);
	setCookie(req.hono, "isLoggedIn", "true", {
		...cookie.attributes,
		httpOnly: false,
	});
}

export async function logout(sessionId: string) {
	await lucia.invalidateSession(sessionId);

	const req = getRequestEvent();
	if (!req) throw new Error("No request event");
	const cookie = lucia.createBlankSessionCookie();
	deleteCookie(req.hono, lucia.sessionCookieName, cookie.attributes);
	deleteCookie(req.hono, "isLoggedIn", {
		...cookie.attributes,
		httpOnly: false,
	});
}
