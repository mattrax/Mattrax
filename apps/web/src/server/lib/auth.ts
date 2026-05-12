import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import * as schema from "~/drizzle/schema";
import { db } from "~/server/lib/db";
import { serverEnv } from "./env";

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "sqlite",
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
    },
  }),
  secret: serverEnv.BETTER_AUTH_SECRET,
  baseURL: serverEnv.BETTER_AUTH_URL,
  emailAndPassword: {
    enabled: true,
    sendResetPassword: async ({ user, url }) => {
      console.log("RESET EMAIL", user, url);
    },
  },
  user: {
    changeEmail: {
      enabled: true,
      sendChangeEmailVerification: async (params: {
        user: { email: string };
        newEmail: string;
        url: string;
      }) => {
        const { user, newEmail, url } = params;
        console.log("CHANGE EMAIL VERIFICATION", user.email, "->", newEmail, url);
      },
    },
  },
});

export type AuthSession = typeof auth.$Infer.Session;
export type AuthUser = AuthSession["user"];
