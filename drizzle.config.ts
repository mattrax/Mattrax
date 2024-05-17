import dotenv from "dotenv";
import { defineConfig } from "drizzle-kit";

dotenv.config({
  path: "../.env",
});

if ("PLANETSCALE_URL" in process.env === false)
  throw new Error("'PLANETSCALE_URL' not set in env");

export default defineConfig({
  schema: "./apps/web/src/db/schema.ts",
  driver: "mysql2",
  dbCredentials: {
    uri: process.env.PLANETSCALE_URL!,
  },
  verbose: true,
  strict: true,
});
