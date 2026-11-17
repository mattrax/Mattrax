import { defineConfig } from "drizzle-kit";

const databaseUrl = process.env.DATABASE_URL?.trim();

/**
 * Migrations use the deployment's single connection string when available.
 * The individual fields remain for local development and the older CI setup.
 */
const credentials = databaseUrl
  ? { url: databaseUrl }
  : {
      host: process.env.DATABASE_HOST ?? "127.0.0.1",
      port: Number(process.env.DATABASE_PORT ?? 3306),
      user: process.env.DATABASE_USER ?? "mattrax",
      password: process.env.DATABASE_PASSWORD ?? "mattrax",
      database: process.env.DATABASE_NAME ?? "mattraxe",
    };

export default defineConfig({
  dialect: "mysql",
  schema: "./src/db/schema.ts",
  out: "./migrations",
  dbCredentials: credentials,
});
