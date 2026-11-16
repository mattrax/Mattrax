import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";
import { startCronScheduler } from "./cron.ts";
import { migrate } from "./migrate.ts";

/**
 * Self-hosted Node runtime.
 *
 * Two entry points share one HTTP port: `/api`, `/mdm` and `/scim` go to the API
 * build, everything else to the dashboard's Solid SSR server. The API's
 * scheduled jobs run from the Effect scheduler in this process instead of a
 * platform cron trigger.
 */

type ScheduledController = {
  cron: string;
  scheduledTime: number;
  noRetry: () => void;
};

type ApiRuntime = {
  fetch(request: Request, context: RuntimeContext): Promise<Response>;
  scheduled(controller: ScheduledController, context: RuntimeContext): Promise<void>;
};

type WebRuntime = {
  listener: (request: IncomingMessage, response: ServerResponse) => void;
};

type RuntimeContext = {
  waitUntil: (promise: Promise<unknown>) => void;
  passThroughOnException: () => void;
};

const root = path.resolve(import.meta.dirname, "..");

const requireEnv = (name: string): string => {
  const value = process.env[name]?.trim();

  if (!value) {
    console.error(`mattrax self-host: ${name} is required`);
    process.exit(1);
  }

  return value;
};

const port = Number(process.env.PORT ?? 8080);

const host = process.env.HOST ?? "0.0.0.0";

const origin = requireEnv("ORIGIN");

const databaseUrl = requireEnv("DATABASE_URL");

// SAFETY: the staged layout places the two bundles at these paths and each
// exports the shape declared above.
const api = (await import(pathToFileURL(path.join(root, "api/node.js")).href)) as ApiRuntime;

// SAFETY: same staged layout; the dashboard host exports `listener`.
const web = (await import(pathToFileURL(path.join(root, "web/server/node.js")).href)) as WebRuntime;

/**
 * Workers hand `waitUntil` promises to the platform. A Node process lives until
 * it is stopped, so the only job here is surfacing a failure instead of leaving
 * an unhandled rejection behind.
 */
const context: RuntimeContext = {
  waitUntil: (promise) => {
    void promise.catch((cause) =>
      console.error("mattrax self-host: background work failed", cause),
    );
  },
  passThroughOnException: () => {},
};

const apiPath = (pathname: string): boolean =>
  pathname === "/api" ||
  pathname.startsWith("/api/") ||
  pathname === "/mdm" ||
  pathname.startsWith("/mdm/") ||
  pathname === "/scim" ||
  pathname.startsWith("/scim/");

const toHeaders = (request: IncomingMessage): Headers => {
  const headers = new Headers();

  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;

    // RFC 6265 cookies are separated by `; `, not the generic list comma.
    headers.set(
      name,
      Array.isArray(value) ? value.join(name.toLowerCase() === "cookie" ? "; " : ", ") : value,
    );
  }

  return headers;
};

type NodeRequestInit = RequestInit & { duplex?: "half" };

type NodeReadableStream = Parameters<typeof Readable.fromWeb>[0];

const toRequest = (request: IncomingMessage): Request => {
  const method = request.method ?? "GET";

  // SAFETY: Node's `toWeb` returns a WHATWG stream of the request bytes;
  // `BodyInit` is the same runtime contract despite the differing declarations.
  const body: BodyInit | undefined =
    method === "GET" || method === "HEAD" ? undefined : (Readable.toWeb(request) as BodyInit);

  const init: NodeRequestInit = {
    method,
    headers: toHeaders(request),
    body,
  };

  // Node's fetch requires `duplex` when the body is a stream.
  if (body !== undefined) init.duplex = "half";

  return new Request(new URL(request.url ?? "/", origin), init);
};

const writeResponse = async (response: Response, target: ServerResponse): Promise<void> => {
  target.statusCode = response.status;

  if (response.statusText) target.statusMessage = response.statusText;

  const cookies = response.headers.getSetCookie();

  response.headers.forEach((value, name) => {
    if (name.toLowerCase() !== "set-cookie") target.setHeader(name, value);
  });

  if (cookies.length > 0) target.setHeader("set-cookie", cookies);

  if (response.body === null) {
    target.end();

    return;
  }

  // SAFETY: both sides consume the WHATWG stream contract; only the ambient
  // Node/DOM declarations differ.
  await pipeline(Readable.fromWeb(response.body as NodeReadableStream), target);
};

const server = createServer((request, response) => {
  const pathname = new URL(request.url ?? "/", origin).pathname;

  if (!apiPath(pathname)) {
    web.listener(request, response);

    return;
  }

  void (async () => {
    try {
      const result = await api.fetch(toRequest(request), context);

      await writeResponse(result, response);
    } catch (cause) {
      console.error("mattrax self-host: API request failed", cause);

      if (!response.headersSent) {
        response.statusCode = 500;
        response.setHeader("content-type", "text/plain; charset=utf-8");
      }

      response.end("Internal Server Error");
    }
  })();
});

if (!process.env.SKIP_MIGRATIONS)
  await migrate({ databaseUrl, migrationsDirectory: path.join(root, "migrations") });

/**
 * The same expressions `cloudflare.config.ts` declares: daily maintenance at
 * 03:17 and the hourly outbox/Entra/certificate sweep at minute 47.
 */
const stopCron = startCronScheduler({
  expressions: ["17 3 * * *", "47 * * * *"],
  trigger: (cron) =>
    api.scheduled(
      // SAFETY: `ScheduledController` only requires the cron expression and
      // schedule time for these handlers; `noRetry` is a no-op in-process.
      {
        cron,
        scheduledTime: Date.now(),
        noRetry: () => {},
      },
      context,
    ),
  log: (message) => console.log(message),
});

server.listen(port, host, () => {
  console.log(`mattrax self-host: listening on http://${host}:${port}`);
});

const shutdown = (signal: string) => {
  console.log(`mattrax self-host: ${signal} received, shutting down`);

  stopCron();
  server.close(() => process.exit(0));

  // A hanging connection must not keep the container alive past its grace
  // period. The reverse proxy drains first in normal operation.
  setTimeout(() => process.exit(0), 10_000).unref();
};

for (const signal of ["SIGTERM", "SIGINT"] as const) process.once(signal, () => shutdown(signal));
