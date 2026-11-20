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

/**
 * Kill whatever still owns the dev-server port.
 *
 * `pnpm` starts the script through `setsid`, so its children can reparent
 * before the tree walk below runs. The port is the one invariant that always
 * identifies the dev server; Playwright's teardown waits for it to close.
 */
const killPort = (): void => {
  try {
    const pids = execFileSync("lsof", ["-ti", "tcp:9050"], { encoding: "utf8" })
      .trim()
      .split("\n")
      .filter(Boolean);

    for (const pid of pids) {
      try {
        process.kill(Number(pid), "SIGKILL");
      } catch {
        // Already gone.
      }
    }
  } catch {
    // No listener (or lsof is unavailable) is not a failure.
  }
};

child.on("exit", (code: number | null) => {
  // pnpm can exit while its Vite children remain. Stop the group and the
  // port immediately; Playwright can SIGKILL this wrapper before a timer runs.
  signalTree("SIGTERM");
  killPort();
  setTimeout(() => {
    signalTree("SIGKILL");
    killPort();
    process.exit(code ?? 1);
  }, 1_000).unref();
});

const stop = (): void => {
  signalTree("SIGTERM");
  // Playwright may SIGKILL this wrapper shortly after SIGTERM, so close the
  // port now rather than waiting for a timer.
  killPort();

  // Give Vite a moment to flush, then force the tree down and exit ourselves
  // so Playwright's webServer teardown cannot hang.
  setTimeout(() => {
    signalTree("SIGKILL");
    killPort();
    process.exit(0);
  }, 1_000).unref();
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

/**
 * Settle every lazy route once before Playwright starts.
 *
 * Solid caches a route module's import promise. In dev a request can end before
 * the first import settles (for example while the optimizer is still writing),
 * and the rejected promise is then cached for that module URL, so every later
 * navigation renders an empty shell. Reading the whole body keeps the request
 * open until the module has resolved.
 */
for (const path of [
  "/",
  "/login",
  "/register",
  "/designer",
  "/dashboard",
  "/account",
  "/tenants",
  "/settings",
]) {
  try {
    const response = await fetch(`http://localhost:9050${path}`);

    await response.text();
  } catch {
    // Best effort: a route that fails still gets a normal request later.
  }
}

// Let the client and SSR optimizers finish writing their caches before
// Playwright starts driving the browser.
await new Promise((resolve) => setTimeout(resolve, 2_000));

// Keep the wrapper alive while the dev server runs; Playwright stops it.
process.stdin.resume();
