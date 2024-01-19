import { object, string } from "valibot";
import { validateEnv } from "./validateEnv";

const env = validateEnv(
  object({
    AUTH_SECRET: string([]),
    MSFT_CLIENT_ID: string([]),
    MSFT_CLIENT_SECRET: string([]),
    MSFT_ADMIN_TENANT: string([]),
    DATABASE_URL: string([]),
  }),
  {
    AUTH_SECRET: process.env.AUTH_SECRET,
    MSFT_CLIENT_ID: process.env.MSFT_CLIENT_ID,
    MSFT_CLIENT_SECRET: process.env.MSFT_CLIENT_SECRET,
    MSFT_ADMIN_TENANT: process.env.MSFT_ADMIN_TENANT,
    DATABASE_URL: process.env.DATABASE_URL,
  },
  "server"
);

const clientEnv = validateEnv(object({}), {}, "client");

// TODO: Error when importing `env` onto the client

export { env, clientEnv };
