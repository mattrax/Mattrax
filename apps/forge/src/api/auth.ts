import { DrizzleMySQLAdapter } from "@lucia-auth/adapter-drizzle";
import { Lucia } from "lucia";

import { accounts, db, sessions } from "~/db";

const adapter = () => new DrizzleMySQLAdapter(db(), sessions, accounts);

function newLucia() {
	return new Lucia(adapter(), {
		sessionCookie: {
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
	});
}

let cached: null | ReturnType<typeof newLucia> = null;

export const lucia = () => {
	if (cached) return cached;

	return (cached = newLucia());
};

declare module "lucia" {
	interface Register {
		Lucia: ReturnType<typeof lucia>;
		DatabaseUserAttributes: DatabaseUserAttributes;
	}
}

interface DatabaseUserAttributes {
	pk: number;
	id: string;
	email: string;
	name: string;
}
