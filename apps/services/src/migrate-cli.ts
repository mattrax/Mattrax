import { migrateDatabase } from "./migrate.ts";

const databaseUrl = process.env.DATABASE_URL?.trim();

if (!databaseUrl) throw new Error("DATABASE_URL is required");

await migrateDatabase({
  databaseUrl,
  migrationsDirectory: new URL("../migrations", import.meta.url).pathname,
});
