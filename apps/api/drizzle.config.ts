import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "mysql",
  schema: "./src/db/schema.ts",
  out: "./migrations",
  dbCredentials: {
    host: process.env.DATABASE_HOST ?? "127.0.0.1",
    port: Number(process.env.DATABASE_PORT ?? 3306),
    user: process.env.DATABASE_USER ?? "mattrax",
    password: process.env.DATABASE_PASSWORD ?? "mattrax",
    database: process.env.DATABASE_NAME ?? "mattraxe",
  },
});
