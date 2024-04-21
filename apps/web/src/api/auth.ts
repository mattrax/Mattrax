import { appendResponseHeader, getCookie, setCookie } from "vinxi/server";
import { DrizzlePostgreSQLAdapter } from "@lucia-auth/adapter-drizzle";
import { cache } from "@solidjs/router";
import { Lucia } from "lucia";

import { accounts, getDb, sessions } from "~/db";
import { env } from "~/env";
import type { Features } from "~/lib/featureFlags";
import { localsCache } from "~/lib/utils";

export const getLucia = localsCache(() => {
	const adapter = new DrizzlePostgreSQLAdapter(getDb(), sessions, accounts);

	return new Lucia(adapter, {
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
}, Symbol("lucia"));

declare module "lucia" {
	interface Register {
		Lucia: ReturnType<typeof getLucia>;
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
	const sessionId = getCookie(getLucia().sessionCookieName) ?? null;

	if (sessionId === null) return;

	const { session, user: account } =
		await getLucia().validateSession(sessionId);

	if (session) {
		if (session.fresh)
			appendResponseHeader(
				"Set-Cookie",
				getLucia().createSessionCookie(session.id).serialize(),
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
			getLucia().createBlankSessionCookie().serialize(),
		);
	}

	if (session && account) return { session, account };
}, "checkAuth");
