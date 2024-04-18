import dotenv from "dotenv";
import { defineConfig } from "drizzle-kit";

dotenv.config({
  path: "../.env",
});

if ("DATABASE_URL" in process.env === false)
  throw new Error("'DATABASE_URL' not set in env");

export default defineConfig({
  out: "./supabase/migrations",
  schema: "./apps/web/src/db/schema.ts",
  driver: "pg",
  dbCredentials: {
    connectionString: process.env.DATABASE_URL!,
  },
  verbose: true,
  strict: true,
});
