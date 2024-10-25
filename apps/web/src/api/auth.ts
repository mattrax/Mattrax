import { DrizzleMySQLAdapter } from "@lucia-auth/adapter-drizzle";
import { cache } from "@solidjs/router";
import { Lucia } from "lucia";
import { getRequestEvent } from "solid-js/web";
import { deleteCookie, getCookie, setCookie } from "vinxi/server";
import { accounts, db, sessions } from "~/db";
import { withEnv } from "~/env";

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
	const req = getRequestEvent();
	if (!req) throw new Error("No request event");

	const sessionId = getCookie(lucia.sessionCookieName) ?? null;

	if (sessionId === null) {
		if (getCookie("isLoggedIn") !== undefined)
			deleteCookie(req.nativeEvent, "isLoggedIn", {
				...lucia.createBlankSessionCookie().attributes,
				httpOnly: false,
			});

		return;
	}

	const { session, user: account } = await lucia.validateSession(sessionId);

	if (session) {
		const cookie = lucia.createSessionCookie(session.id);
		if (session.fresh)
			setCookie(req.nativeEvent, cookie.name, cookie.value, cookie.attributes);
		if (getCookie("isLoggedIn") === undefined) {
			setCookie("isLoggedIn", "true", {
				...cookie.attributes,
				httpOnly: false,
			});
		}
	} else {
		const cookie = lucia.createBlankSessionCookie();
		setCookie(req.nativeEvent, cookie.name, cookie.value, cookie.attributes);
		deleteCookie(req.nativeEvent, "isLoggedIn", {
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
	setCookie(req.nativeEvent, cookie.name, cookie.value, cookie.attributes);
	setCookie(req.nativeEvent, "isLoggedIn", "true", {
		...cookie.attributes,
		httpOnly: false,
	});
}

export async function logout(sessionId: string) {
	await lucia.invalidateSession(sessionId);

	const req = getRequestEvent();
	if (!req) throw new Error("No request event");
	const cookie = lucia.createBlankSessionCookie();
	deleteCookie(req.nativeEvent, lucia.sessionCookieName, cookie.attributes);
	deleteCookie(req.nativeEvent, "isLoggedIn", {
		...cookie.attributes,
		httpOnly: false,
	});
}
