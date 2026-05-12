import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createDb } from "./db/index.js";
import * as schema from "./db/schema.js";
import type { ApiEnv } from "./env.js";

export const createAuth = (env: ApiEnv) =>
  betterAuth({
    database: drizzleAdapter(createDb(env.DB), {
      provider: "sqlite",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
      },
    }),
    secret: env.AUTH_SECRET,
    baseURL: env.ORIGIN,
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
