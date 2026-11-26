import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Effect, Exit, Scope } from "effect";
import { createBackgroundTasks } from "./backgroundTasks.js";
import { runtimeConfigFromEnv } from "./config.js";
import { startCronScheduler } from "./cron.js";
import { migrate } from "./migrate.js";
import { makeApiHttpHandler } from "./httpBridge.js";
import type { ApiRuntime, RuntimeContext } from "./httpBridge.js";

/**
 * Self-hosted Node runtime.
 *
 * Two entry points share one HTTP port: `/api`, `/mdm` and `/scim` go to the API
 * build, everything else to the dashboard's Solid SSR server. The API's
 * scheduled jobs run from the Effect scheduler in this process instead of a
 * platform cron trigger.
 */

type WebRuntime = {
  listener: (request: IncomingMessage, response: ServerResponse) => void;
};

// Validate host and database configuration before importing the API bundle or
// running migrations. Invalid values fail the container immediately.
const config = runtimeConfigFromEnv(process.env);
const { host, port, origin, databaseUrl, skipMigrations } = config;
const root = path.resolve(import.meta.dirname, "..");

// SAFETY: the staged layout places the two bundles at these paths and each
// exports the shape declared above.
const api = (await import(pathToFileURL(path.join(root, "api/node.js")).href)) as ApiRuntime;

// SAFETY: same staged layout; the dashboard host exports `listener`.
const web = (await import(pathToFileURL(path.join(root, "web/server/node.js")).href)) as WebRuntime;

const backgroundTasks = createBackgroundTasks();
const context: RuntimeContext = {
  waitUntil: backgroundTasks.waitUntil,
  passThroughOnException: () => {},
  signal: backgroundTasks.signal,
};

const apiPath = (pathname: string): boolean =>
  pathname === "/api" ||
  pathname.startsWith("/api/") ||
  pathname === "/mdm" ||
  pathname.startsWith("/mdm/") ||
  pathname === "/scim" ||
  pathname.startsWith("/scim/");

// A single Effect scope owns every API request fiber. NodeHttpServer handles
// streaming, client disconnects and post-header failures without allowing this
// bridge to append a second error body.
const requestScope = await Effect.runPromise(Scope.make());
const apiHandler = await Effect.runPromise(makeApiHttpHandler(api, context, requestScope));

const server = createServer((request, response) => {
  const pathname = new URL(request.url ?? "/", origin).pathname;

  if (!apiPath(pathname)) {
    web.listener(request, response);

    return;
  }

  apiHandler(request, response);
});

if (!skipMigrations)
  await migrate({ databaseUrl, migrationsDirectory: path.join(root, "migrations") });

/**
 * The same expressions `cloudflare.config.ts` declares: daily maintenance at
 * 03:17 and the hourly outbox/Entra/certificate sweep at minute 47.
 */
const stopCron = startCronScheduler({
  expressions: ["17 3 * * *", "47 * * * *"],
  trigger: async (cron) => {
    // Only work registered by this tick may hold the overlap guard. Request
    // analytics and other process-wide work stay in the shutdown collector.
    const tickTasks = backgroundTasks.fork();

    await api.scheduled(
      // SAFETY: `ScheduledController` only requires the cron expression and
      // schedule time for these handlers; `noRetry` is a no-op in-process.
      {
        cron,
        scheduledTime: Date.now(),
        noRetry: () => {},
      },
      { ...context, waitUntil: tickTasks.waitUntil, signal: tickTasks.signal },
    );
    // scheduled returns after registering Workers waitUntil work. Keep the
    // scheduler's running guard set until this tick's jobs actually finish.
    await tickTasks.idle();
  },
  log: (message) => console.log(message),
});

server.listen(port, host, () => {
  console.log(`mattrax self-host: listening on http://${host}:${port}`);
});

const shutdown = async (signal: string): Promise<void> => {
  console.log(`mattrax self-host: ${signal} received, shutting down`);

  stopCron();
  const deadline = Date.now() + 10_000;
  const forceExit = setTimeout(() => {
    void Effect.runPromise(Scope.close(requestScope, Exit.void)).finally(() => process.exit(0));
  }, 10_000);
  forceExit.unref();
  const serverClosed = new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
  const remaining = () => Math.max(0, deadline - Date.now());
  const results = await Promise.all([
    serverClosed,
    backgroundTasks.drain(remaining()),
    api.backgroundTasks?.drain(remaining()),
    stopCron.idle(),
  ]);

  if (results.some((result) => result === "interrupted"))
    console.warn("mattrax self-host: background work exceeded the shutdown deadline");

  await Effect.runPromise(Scope.close(requestScope, Exit.void));
  clearTimeout(forceExit);
  process.exit(0);
};

for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(signal, () => void shutdown(signal));
