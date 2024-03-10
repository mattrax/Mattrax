import { DrizzleMySQLAdapter } from "@lucia-auth/adapter-drizzle";
import { Lucia } from "lucia";

import { accounts, getDb, sessions } from "~/db";
import { getEnv } from "~/env";

export const getLucia = () =>
	new Lucia(new DrizzleMySQLAdapter(getDb(), sessions, accounts), {
		sessionCookie: {
			attributes: {
				// set to `true` when using HTTPS
				secure: getEnv().NODE_ENV === "production",
			},
		},
		getUserAttributes: (data) => ({
			pk: data.pk,
			id: data.id,
			email: data.email,
			name: data.name,
		}),
	});

declare module "lucia" {
	interface Register {
		Lucia: ReturnType<typeof getLucia>;
		DatabaseUserAttributes: DatabaseUserAttributes;
	}
}

interface DatabaseUserAttributes {
	pk: number;
	id: string;
	email: string;
	name: string;
}
