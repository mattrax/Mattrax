import { defineConfig } from "drizzle-kit";

const databaseUrl = process.env.DATABASE_URL?.trim();

/**
 * `DATABASE_URL` is the deployment connection string. MySQL URLs commonly
 * carry `?ssl-mode=REQUIRED`, which mysql2 does not understand and would
 * silently ignore; translate it into the `ssl` object the driver accepts.
 */
const credentialsFromUrl = (value: string) => {
  const url = new URL(value);

  const sslMode =
    url.searchParams.get("ssl-mode") ??
    url.searchParams.get("ssl_mode") ??
    url.searchParams.get("ssl");

  if (!sslMode) {
    return { url: value };
  }

  url.searchParams.delete("ssl-mode");
  url.searchParams.delete("ssl_mode");
  url.searchParams.delete("ssl");

  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 3306,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\/+/, ""),
    ssl: {
      // MySQL's REQUIRED means "encrypt but do not verify the chain"; only the
      // VERIFY_* modes ask the driver to validate it.
      rejectUnauthorized: ["VERIFY_CA", "VERIFY_IDENTITY", "TRUE"].includes(sslMode.toUpperCase()),
    },
  };
};

const credentials = databaseUrl
  ? credentialsFromUrl(databaseUrl)
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
