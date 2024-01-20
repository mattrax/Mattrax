import dotenv from "dotenv";
import { defineConfig } from "drizzle-kit";

dotenv.config({
  path: "../.env",
});

if ("DATABASE_URL" in process.env === false)
  throw new Error("'DATABASE_URL' not set in env");

export default defineConfig({
  schema: "./api/src/db/schema.ts",
  driver: "mysql2",
  dbCredentials: {
    uri: process.env.DATABASE_URL!,
  },
  tablesFilter: ["forge_"],
  verbose: true,
  strict: true,
});
