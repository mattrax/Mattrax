// @ts-expect-error
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";
import "dotenv/config";

function optional_in_dev<T extends z.ZodTypeAny>(
  schema: T
): z.ZodOptional<T> | T {
  return process.env.NODE_ENV === "development" ? schema.optional() : schema;
}

export const env = createEnv({
  server: {
    AUTH_SECRET: z.string(),
    DATABASE_URL: z.string(),
    INTERNAL_SECRET: z.string(),
    PROD_URL: z.string(),
    MDM_URL: z.string(),
    EMAIL_URL: z.string(),
    FROM_ADDRESS: z.string(),
    // Emails and other AWS services
    // Get these values from the output of the Cloudformation template
    AWS_ACCESS_KEY_ID: optional_in_dev(z.string()),
    AWS_SECRET_ACCESS_KEY: optional_in_dev(z.string()),
    // Stipe billing
    STRIPE_PUBLISHABLE_KEY: z.string(),
    STRIPE_SECRET_KEY: z.string(),
    // Used for syncing users from Entra to Mattrax
    ENTRA_CLIENT_ID: z.string(),
    ENTRA_CLIENT_SECRET: z.string(),
    // Intune/SimpleMDM MDM Backend
    INTUNE_CLIENT_ID: z.string(),
    INTUNE_CLIENT_SECRET: z.string(),
    INTUNE_TENANT: z.string(),
    SIMPLEMDM_API_KEY: z.string(),
  },
  clientPrefix: "VITE_",
  client: {},
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
