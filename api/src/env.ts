import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    AUTH_SECRET: z.string(),
    MSFT_CLIENT_ID: z.string(),
    MSFT_CLIENT_SECRET: z.string(),
    MSFT_ADMIN_TENANT: z.string(),
    DATABASE_URL: z.string(),
    // Get these values from the output of the Cloudformation template
    AWS_ACCESS_KEY_ID: z.string(),
    AWS_SECRET_ACCESS_KEY: z.string(),
  },
  clientPrefix: "VITE_",
  client: {},
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
