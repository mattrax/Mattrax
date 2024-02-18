import { Lucia } from "lucia";
import { DrizzleMySQLAdapter } from "@lucia-auth/adapter-drizzle";

import { accounts, sessions, db } from "./db";
import { env } from "./env";

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
}
