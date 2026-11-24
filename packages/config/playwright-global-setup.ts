import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { normalizeE2EBaseUrl } from "./e2e-target.ts";

const repository = fileURLToPath(new URL("../..", import.meta.url));
const defaultDevDatabaseUrl = "mysql://mattrax:mattrax@127.0.0.1:3306/mattraxe";
const localDatabaseHosts = new Set(["localhost", "127.0.0.1", "::1"]);

const migrationEnvironment = (): NodeJS.ProcessEnv => {
  const env = { ...process.env };

  // Drizzle Kit prefers DATABASE_URL and then DATABASE_*. Those variables are
  // for deployments; browser tests must use the dev server's database instead.
  for (const key of Object.keys(env)) if (key.startsWith("DATABASE_")) delete env[key];

  const databaseUrl = process.env.MATTRAX_DEV_DATABASE_URL?.trim() || defaultDevDatabaseUrl;
  const url = new URL(databaseUrl);

  if (url.protocol !== "mysql:" || !url.pathname || url.pathname === "/")
    throw new Error("MATTRAX_DEV_DATABASE_URL must be a MySQL URL with a database name");

  const host = url.hostname.replaceAll(/^\[|\]$/g, "").toLowerCase();

  if (!localDatabaseHosts.has(host) && process.env.E2E_ALLOW_REMOTE_DATABASE !== "1")
    throw new Error(
      `Refusing to migrate non-local E2E database host "${host}". ` +
        "Use a local MATTRAX_DEV_DATABASE_URL or set E2E_ALLOW_REMOTE_DATABASE=1 explicitly.",
    );

  env.DATABASE_URL = databaseUrl;

  return env;
};

/** Keep local browser tests on the same schema as the checkout. */
export default async function globalSetup(): Promise<void> {
  // An explicitly targeted deployment owns its migrations.
  if (normalizeE2EBaseUrl(process.env.E2E_BASE_URL)) return;

  execFileSync("pnpm", ["cloud", "db:migrate"], {
    cwd: repository,
    env: migrationEnvironment(),
    stdio: "inherit",
  });
}
