import { defineConfig } from "@playwright/test";

/**
 * Browser tests drive the real dashboard over CDP using the locally installed
 * Chrome. The dev server and MySQL are expected to be running; set
 * `E2E_BASE_URL` to target an already-running deployment (for example staging).
 */
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:9050",
    // Locally we drive the installed Chrome over CDP; CI uses the bundled
    // Chromium build (also CDP) so no system browser is required.
    channel: process.env.E2E_CHANNEL === "bundled" ? undefined : (process.env.E2E_CHANNEL ?? "chrome"),
    headless: true,
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "pnpm web dev",
        url: "http://localhost:9050",
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
