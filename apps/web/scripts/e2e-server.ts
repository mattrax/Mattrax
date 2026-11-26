import { execFileSync, spawn } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";
import process from "node:process";

/**
 * Serve the dashboard for browser tests.
 *
 * Every test pays for document loads, and the dev server makes each one
 * expensive: Vite transforms modules per request and the browser hydrates an
 * unbundled client. On the same machine a dashboard page hydrates in ~650ms in
 * dev mode and ~70ms from the built bundles, and the suite navigates thousands
 * of times. CI therefore serves the production build through `vite preview`
 * (`E2E_SERVER=built`); `E2E_SERVER=dev` (the default) keeps the hot-reloading
 * dev server for working on specs and product code locally.
 *
 * Both modes listen on 9050 so the suite's baseURL and the API's `ORIGIN` are
 * the same in each.
 */
const mode = process.env.E2E_SERVER?.trim().toLowerCase() === "built" ? "built" : "dev";

const repository = path.resolve(import.meta.dirname, "../../..");

if (mode === "built") {
  // `vite preview` keeps miniflare's HTTP cache on disk. A document cached by an
  // earlier build keeps its old asset hashes and every script 404s, so the page
  // never hydrates. Start every built run with a cold cache.
  rmSync(path.join(repository, "apps/web/.cloudflare/state/v3/cache"), {
    recursive: true,
    force: true,
  });
}

if (mode === "built" && process.env.E2E_SKIP_BUILD !== "1") {
  console.error("[e2e-server] building the production bundles");
  execFileSync("pnpm", ["--filter", "@mattrax/web", "build"], {
    cwd: repository,
    stdio: "inherit",
    env: { ...process.env, NO_COLOR: "1" },
  });
}

const [command, args, cwd] =
  mode === "built"
    ? // `--host ::` is the dual-stack wildcard. `vite preview` otherwise binds
      // only whichever address `localhost` resolves to first (::1 on macOS),
      // and Playwright's readiness probe then spends minutes retrying
      // 127.0.0.1 before the server is considered available.
      ([
        "pnpm",
        ["exec", "vp", "preview", "--port", "9050", "--strictPort", "--host", "::"],
        path.join(repository, "apps/web"),
      ] as const)
    : (["pnpm", ["web", "dev"], repository] as const);

/**
 * Start the server and, in dev mode, give its dependency optimizer time to
 * finish. On a cold CI checkout the optimizer writes its manifest and chunks
 * after the first request; killing it mid-write leaves stale chunk URLs and
 * every page load fails. One warm process avoids that race entirely.
 */
const child = spawn(command, args, {
  cwd,
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
  // Do not depend on lsof: the GitHub runner does not guarantee it. Scan the
  // process table for this checkout's Vite/dev-server processes instead.
  try {
    const repository = process.cwd();
    const rows = execFileSync("ps", ["-A", "-o", "pid=,command="], { encoding: "utf8" })
      .trim()
      .split("\n");

    for (const row of rows) {
      const match = /^\s*(\d+)\s+(.*)$/.exec(row);

      if (!match) continue;

      const pid = Number(match[1]);
      const command = match[2] ?? "";

      if (pid === process.pid || !command.includes(repository)) continue;

      if (
        /vite\.js\s+(dev|preview)/.test(command) ||
        /vite-plus[^ ]*\b(dev|preview)\b/.test(command) ||
        /pnpm[^ ]*\s+web\s+dev/.test(command) ||
        command.includes("scripts/generate-licences")
      ) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // Already gone.
        }
      }
    }
  } catch {
    // A missing ps or no matching process is not a teardown failure.
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

// Let the client and SSR optimizers finish writing their caches before
// Playwright starts driving the browser. A built server has no optimizer to
// wait for.
if (mode === "dev") await new Promise((resolve) => setTimeout(resolve, 10_000));

// Keep the wrapper alive while the dev server runs; Playwright stops it.
process.stdin.resume();
