import { execFileSync, spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

/**
 * The production bundle is the only place the real `/assets/*.js` chunk URLs
 * exist; the dev server serves route modules from `/src`. This spec builds and
 * runs the self-host bundle so the failure is exercised through Vite's actual
 * `vite:preloadError` path rather than a fabricated event.
 */
const repository = fileURLToPath(new URL("../..", import.meta.url));

const port = 9061;

const base = `http://127.0.0.1:${port}`;

let server: ChildProcess | undefined;

test.describe("skew protection (production bundle)", () => {
  test.beforeAll(() => {
    execFileSync("pnpm", ["--filter", "@mattrax/web", "build:selfhost"], {
      cwd: repository,
      stdio: "pipe",
    });

    server = spawn(process.execPath, ["apps/web/dist/server/node.js"], {
      cwd: repository,
      env: {
        ...process.env,
        PORT: String(port),
        ORIGIN: base,
        AUTH_SECRET: "e2e-selfhost-auth-secret-0123456789abcdef",
        // The failure under test is client-side. Point the API at a closed
        // loopback port so the signed-out login shell renders without
        // recursing through this same server's /api proxy.
        API_URL: "http://127.0.0.1:1",
      },
      stdio: "pipe",
    });
  });

  test.afterAll(() => {
    server?.kill("SIGTERM");
  });

  test("reloads exactly once when a route chunk is missing", async ({ page }) => {
    await page.addInitScript(() => {
      // `name` survives same-tab navigation, so it counts documents loaded.
      window.name = String(Number(window.name || "0") + 1);
    });

    await expect
      .poll(async () => (await fetch(`${base}/login`).catch(() => undefined))?.status)
      .toBe(200);

    await page.goto(`${base}/login`);
    await page.waitForFunction(() => document.documentElement.dataset.hydrated === "true");

    expect(await page.evaluate(() => window.name)).toBe("1");

    // A real route chunk request, answered with the 404 a deployment would
    // produce after its hashed asset disappeared.
    await page.route("**/assets/register-*.js", (route) =>
      route.fulfill({
        status: 404,
        contentType: "text/javascript; charset=utf-8",
        body: "not found",
      }),
    );

    await page.getByRole("link", { name: /sign up/i }).click();
    await page.waitForFunction(() => window.name === "2", undefined, { timeout: 10_000 });
    await page.waitForFunction(() => document.documentElement.dataset.hydrated === "true");
    await expect.poll(() => page.url()).not.toContain("__chunk_reload");

    // The reloaded document carries the one-shot marker, so the same failure
    // must not refresh again. The failed import is caught by the app's error
    // boundary, which reports it with console.error rather than as an uncaught
    // pageerror. Wait for that report instead of a pageerror that never fires.
    const rethrown = page.waitForEvent("console", {
      predicate: (message) =>
        message.type() === "error" && message.text().includes("/assets/register-"),
      timeout: 10_000,
    });
    await page.getByRole("link", { name: /sign up/i }).click();
    await rethrown;

    expect(await page.evaluate(() => window.name)).toBe("2");
  });
});
