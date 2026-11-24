import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repository = fileURLToPath(new URL("../..", import.meta.url));

/** Keep local browser tests on the same schema as the checkout. */
export default async function globalSetup(): Promise<void> {
  // An explicitly targeted deployment owns its migrations.
  if (process.env.E2E_BASE_URL?.trim()) return;

  execFileSync("pnpm", ["cloud", "db:migrate"], {
    cwd: repository,
    env: process.env,
    stdio: "inherit",
  });
}
