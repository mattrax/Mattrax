import { spawn } from "node:child_process";
import process from "node:process";

/**
 * Start the Vite dev server for browser tests and give its dependency optimizer
 * time to finish. On a cold CI checkout the optimizer writes its manifest and
 * chunks after the first request; killing it mid-write leaves stale chunk URLs
 * and every page load fails. One warm process avoids that race entirely.
 */
const child = spawn("pnpm", ["web", "dev"], {
  stdio: "inherit",
  env: { ...process.env, NO_COLOR: "1" },
});

child.on("error", (error: Error) => {
  console.error("Failed to start the dev server", error);
  process.exit(1);
});

child.on("exit", (code: number | null) => process.exit(code ?? 1));

const stop = (): void => {
  if (child.exitCode === null) child.kill("SIGTERM");
};

process.on("SIGINT", stop);

process.on("SIGTERM", stop);

const waitForServer = async (timeoutMs = 90_000): Promise<void> => {
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

await waitForServer();

// Let the client and SSR optimizers finish writing their caches before
// Playwright starts driving the browser.
await new Promise((resolve) => setTimeout(resolve, 10_000));

// Keep the wrapper alive while the dev server runs; Playwright stops it.
process.stdin.resume();
