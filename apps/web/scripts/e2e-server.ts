import { execFileSync, spawn } from "node:child_process";
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
  // A process group lets teardown stop Vite and its workers, not just the
  // `pnpm` wrapper. Killing only pnpm can leave the dev server holding the
  // port, which makes Playwright's webServer teardown hang until the job times
  // out even though every test passed.
  detached: true,
});

child.on("error", (error: Error) => {
  console.error("Failed to start the dev server", error);
  process.exit(1);
});

/**
 * Signal every process below the dev-server wrapper.
 *
 * `pnpm web dev` starts its script through `setsid`, so Vite and its workers
 * live in a different process group from the `pnpm` pid. Signalling only the
 * group (or the pid) leaves Vite holding port 9050, and Playwright then waits
 * forever for the port to close even though every test passed. Walking the
 * `ps` parent table catches Vite regardless of which session it chose.
 */
const signalTree = (signal: NodeJS.Signals): void => {
  if (child.pid === undefined) return;

  const pid = child.pid;
  const rows = execFileSync("ps", ["-A", "-o", "pid=,ppid="], { encoding: "utf8" })
    .trim()
    .split("\n")
    .flatMap((line) => {
      const [child, parent] = line.trim().split(/\s+/).map(Number);

      return child === undefined || parent === undefined ? [] : [[child, parent] as const];
    });

  const byParent = new Map<number, Array<number>>();

  for (const [childPid, parentPid] of rows) {
    const list = byParent.get(parentPid) ?? [];

    list.push(childPid);
    byParent.set(parentPid, list);
  }

  const pending = [pid];
  const tree: Array<number> = [];

  while (pending.length > 0) {
    const current = pending.pop()!;

    tree.push(current);

    for (const descendant of byParent.get(current) ?? []) pending.push(descendant);
  }

  // Children first: a parent that exits can otherwise reparent them before
  // they receive the signal.
  for (const current of tree.reverse()) {
    try {
      process.kill(current, signal);
    } catch {
      // Already gone.
    }
  }
};

child.on("exit", (code: number | null) => {
  // pnpm can exit while its Vite children remain. Stop the group before
  // leaving so teardown cannot strand the port.
  signalTree("SIGTERM");
  setTimeout(() => {
    signalTree("SIGKILL");
    process.exit(code ?? 1);
  }, 1_000).unref();
});

const stop = (): void => {
  signalTree("SIGTERM");

  // Give Vite a moment to flush, then force the tree down and exit ourselves
  // so Playwright's webServer teardown cannot hang.
  setTimeout(() => {
    signalTree("SIGKILL");
    process.exit(0);
  }, 3_000).unref();
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
