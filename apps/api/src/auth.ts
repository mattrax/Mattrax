import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createDb } from "./db/index.js";
import * as schema from "./db/schema.js";

type AuthEnv = Env & {
  BETTER_AUTH_SECRET: string;
};

export const createAuth = (env: AuthEnv) =>
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
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
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
