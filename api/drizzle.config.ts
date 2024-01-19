import dotenv from "dotenv";
import { defineConfig } from "drizzle-kit";

dotenv.config({
  path: "../.env",
});

export default defineConfig({
  schema: "./src/server/db/schema.ts",
  driver: "mysql2",
  dbCredentials: {
    uri: process.env.DATABASE_URL!, // TODO: use t3 env
  },
  tablesFilter: ["forge_"],
  verbose: true,
  strict: true,
});
