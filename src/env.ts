import { object, string } from "valibot";
import { validateEnv } from "./server/validateEnv";

const env = validateEnv(
  object({
    SESSION_SECRET: string([]),
  }),
  {
    SESSION_SECRET: process.env.SESSION_SECRET,
  }
);

const clientEnv = validateEnv(object({}), {});

// TODO: Error when importing `env` onto the client

export { env, clientEnv };
