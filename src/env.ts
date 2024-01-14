import { object, string } from "valibot";
import { validateEnv } from "./server/validateEnv";

const env = validateEnv(
  object({
    AUTH_SECRET: string([]),
    MSFT_CLIENT_ID: string([]),
    MSFT_CLIENT_SECRET: string([]),
    MSFT_ADMIN_TENANT: string([]),
  }),
  {
    AUTH_SECRET: process.env.AUTH_SECRET,
    MSFT_CLIENT_ID: process.env.MSFT_CLIENT_ID,
    MSFT_CLIENT_SECRET: process.env.MSFT_CLIENT_SECRET,
    MSFT_ADMIN_TENANT: process.env.MSFT_ADMIN_TENANT,
  }
);

const clientEnv = validateEnv(object({}), {});

// TODO: Error when importing `env` onto the client

export { env, clientEnv };
