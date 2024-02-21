import dotenv from "dotenv";
import { defineConfig } from "drizzle-kit";

dotenv.config({
  path: "../.env",
});

if ("DATABASE_URL" in process.env === false)
  throw new Error("'DATABASE_URL' not set in env");

export default defineConfig({
  schema: "./apps/forge/src/db/schema.ts",
  driver: "mysql2",
  dbCredentials: {
    uri: process.env.DATABASE_URL!,
  },
  verbose: true,
  strict: true,
});
