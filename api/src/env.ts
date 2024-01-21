import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

function optional_in_dev<T extends z.ZodTypeAny>(
  schema: T
): z.ZodOptional<T> | T {
  return process.env.NODE_ENV === "development" ? schema.optional() : schema;
}

export const env = createEnv({
  server: {
    AUTH_SECRET: z.string(),
    MSFT_CLIENT_ID: z.string(),
    MSFT_CLIENT_SECRET: z.string(),
    MSFT_ADMIN_TENANT: z.string(),
    DATABASE_URL: z.string(),
    INTERNAL_SECRET: z.string(),
    VERCEL_URL: z.string(),
    // Get these values from the output of the Cloudformation template
    AWS_ACCESS_KEY_ID: optional_in_dev(z.string()),
    AWS_SECRET_ACCESS_KEY: optional_in_dev(z.string()),
  },
  clientPrefix: "VITE_",
  client: {},
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
