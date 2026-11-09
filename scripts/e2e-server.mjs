import { spawn } from "node:child_process";
import process from "node:process";

/**
 * Start the Vite dev server twice for browser tests.
 *
 * Vite's dependency optimizer runs on the first cold start and reloads the page
 * when it discovers a new dependency. On CI (no `.vite` cache) that reload can
 * land while a test is typing into a form. The first run warms the cache; the
 * second run is stable and is the one Playwright talks to.
 */
const command = ["pnpm", "web", "dev"];
let child;

const start = () =>
  new Promise((resolve, reject) => {
    child = spawn(command[0], command.slice(1), {
      stdio: "inherit",
      env: { ...process.env, NO_COLOR: "1" },
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code && code !== 0) reject(new Error(`dev server exited with ${code}`));
    });
    resolve();
  });

const stop = () =>
  new Promise((resolve) => {
    if (!child || child.exitCode !== null) return resolve();
    child.once("exit", resolve);
    child.kill("SIGTERM");
    setTimeout(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
      resolve();
    }, 10_000).unref();
  });

const waitForServer = async (timeoutMs = 90_000) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const health = await fetch("http://localhost:9050/api/health");
      const page = await fetch("http://localhost:9050/login");
      if (health.ok && page.ok) return;
    } catch {
      // Not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("dev server did not become healthy in time");
};

const shutdown = async () => {
  await stop();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await start();
await waitForServer();
// Give the client and SSR optimizers time to finish their discovery pass.
await new Promise((resolve) => setTimeout(resolve, 3_000));
await stop();
await start();
await waitForServer();
// Playwright owns the process from here; keep this wrapper alive.
await new Promise(() => {});
