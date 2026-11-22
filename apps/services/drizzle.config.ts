import { defineConfig } from "drizzle-kit";

const databaseUrl = process.env.DATABASE_URL?.trim();

const credentialsFromUrl = (value: string) => {
  const url = new URL(value);
  const sslMode = (
    url.searchParams.get("ssl-mode") ??
    url.searchParams.get("ssl_mode") ??
    url.searchParams.get("ssl") ??
    ""
  ).toUpperCase();

  if (!sslMode) return { url: value };

  url.searchParams.delete("ssl-mode");
  url.searchParams.delete("ssl_mode");
  url.searchParams.delete("ssl");

  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 3306,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\/+/, ""),
    ssl: { rejectUnauthorized: ["VERIFY_CA", "VERIFY_IDENTITY", "TRUE"].includes(sslMode) },
  };
};

export default defineConfig({
  dialect: "mysql",
  // The services tables live beside the billing implementation so there is one
  // definition for the routes, the webhook and the migration.
  schema: "../../packages/enterprise-billing/src/schema.ts",
  out: "./migrations",
  dbCredentials: databaseUrl
    ? credentialsFromUrl(databaseUrl)
    : {
        host: process.env.DATABASE_HOST ?? "127.0.0.1",
        port: Number(process.env.DATABASE_PORT ?? 3306),
        user: process.env.DATABASE_USER ?? "root",
        password: process.env.DATABASE_PASSWORD ?? "",
        database: process.env.DATABASE_NAME ?? "railway",
      },
});
