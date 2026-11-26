import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";
import { DEFAULT_E2E_BASE_URL, normalizeE2EBaseUrl } from "./e2e-target.ts";

/**
 * Browser tests drive the real dashboard over CDP using the locally installed
 * Chrome. The dev server and MySQL are expected to be running; set
 * `E2E_BASE_URL` to target an already-running deployment (for example staging).
 */
/** The repository root, which is where `pnpm test:e2e` is invoked. */
const repository = fileURLToPath(new URL("../..", import.meta.url));
const e2eBaseUrl = normalizeE2EBaseUrl(process.env.E2E_BASE_URL);

export default defineConfig({
  // Resolve from this package so `pnpm test:e2e` works from the repo root.
  testDir: path.join(repository, "tests/e2e"),
  // Playwright defaults these to the config file's directory; both are
  // repository-level paths (CI uploads `test-results/`).
  outputDir: path.join(repository, "test-results"),
  // A reused local dev server can predate the latest migration. Apply pending
  // migrations before tests even when Playwright did not start the server.
  globalSetup: fileURLToPath(new URL("./playwright-global-setup.ts", import.meta.url)),
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  // Specs use unique emails/tenants and the dev mailbox looks codes up by
  // recipient, so different files can run in parallel safely. Keep one worker
  // locally for readable failures; CI uses two to fit the suite in fewer
  // shards.
  workers: process.env.CI ? 2 : 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: e2eBaseUrl ?? DEFAULT_E2E_BASE_URL,
    // Locally we drive the installed Chrome over CDP; CI uses the bundled
    // Chromium build (also CDP) so no system browser is required.
    channel:
      process.env.E2E_CHANNEL === "bundled" ? undefined : (process.env.E2E_CHANNEL ?? "chrome"),
    headless: true,
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: e2eBaseUrl
    ? undefined
    : {
        command: "tsx apps/web/scripts/e2e-server.ts",
        cwd: repository,
        url: DEFAULT_E2E_BASE_URL,
        reuseExistingServer: true,
        timeout: 180_000,
      },
});
