#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Log, LogLevel, Miniflare } from "miniflare";
import type { MiniflareOptions } from "miniflare";
import type {
  AssetsOptions,
  Binding,
  WorkerConfig,
  WorkerDeployment,
  WorkerModule,
  WorkerTrigger,
} from "./config.ts";
import { findBinding, readWorkerConfig } from "./config.ts";
import { startCronScheduler } from "./cron.ts";
import { migrate } from "./migrate.ts";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * In the container the built Workers live at /app/workers. During local
 * development they sit in each app's `.cloudflare` output directory.
 */
const workersDirectory = path.resolve(
  process.env.MATTRAX_WORKERS_DIR ?? path.join(here, "..", "workers"),
);

const dataDirectory = path.resolve(process.env.DATA_DIR ?? path.join(here, "..", ".data"));
const port = Number(process.env.PORT ?? 8080);
const host = process.env.HOST ?? "0.0.0.0";

function fail(message: string): never {
  console.error(`mattrax self-host: ${message}`);

  process.exit(1);
}

const requireEnv = (name: string): string => {
  const value = process.env[name];

  if (!value) fail(`${name} is required`);

  return value;
};

const origin = requireEnv("ORIGIN");
const authSecret = requireEnv("AUTH_SECRET");
const databaseUrl = requireEnv("DATABASE_URL");

const requireHttpsOrigin = (): void => {
  let url: URL;

  try {
    url = new URL(origin);
  } catch {
    fail("ORIGIN must be an absolute URL");
  }

  // Loopback HTTP is allowed so a built image can be exercised locally; every
  // real deployment sits behind TLS because passkeys need a secure origin.
  const loopbackHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopbackHosts.has(url.hostname)))
    fail("ORIGIN must use https; passkeys and email magic links require a secure origin");
};

requireHttpsOrigin();

if (Buffer.byteLength(authSecret) < 32)
  fail("AUTH_SECRET must be at least 32 bytes; generate one with `openssl rand -base64 32`");

const api = await readWorkerConfig(path.join(workersDirectory, "api"));
const web = await readWorkerConfig(path.join(workersDirectory, "web"));

const hyperdriveBinding = findBinding(api.config, "hyperdrive");
const storageBinding = findBinding(api.config, "r2");
const emailBinding = findBinding(api.config, "send-email");
const apiServiceBinding = findBinding(web.config, "worker");

if (!hyperdriveBinding) fail("the API Worker does not declare a Hyperdrive binding");

if (!storageBinding) fail("the API Worker does not declare an R2 binding");

if (!apiServiceBinding) fail("the web Worker does not declare an API service binding");

/**
 * `cf build` writes a partial module manifest plus the module files. Workerd
 * needs the contents inline, so expand it here. Source maps are dropped: they
 * are only useful for a debugger and roughly double the size of the bundle.
 */
const loadManifest = async (
  directory: string,
  config: WorkerConfig,
  { cron = false }: { cron?: boolean } = {},
): Promise<WorkerConfig> => {
  const bundle = path.join(directory, "bundle");
  const modules: Record<string, WorkerModule> = {};

  for (const entry of await readdir(bundle, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;

    const absolute = path.join(entry.parentPath, entry.name);
    const name = path.relative(bundle, absolute).split(path.sep).join("/");
    const extension = path.extname(name);

    if (extension === ".map") continue;

    if (extension === ".js")
      modules[name] = { type: "esm", contents: await readFile(absolute, "utf8") };
    else if (extension === ".wasm")
      modules[name] = { type: "wasm", contents: new Uint8Array(await readFile(absolute)) };
    else if (extension === ".json")
      modules[name] = { type: "json", contents: await readFile(absolute, "utf8") };
    else if (extension === ".txt" || extension === ".html")
      modules[name] = { type: "text", contents: await readFile(absolute, "utf8") };
  }

  /**
   * Cloudflare invokes cron triggers from its own scheduler. workerd has no
   * clock, so expose the scheduled handler over an internal route guarded by a
   * secret generated at startup. The route is only usable through the
   * dashboard's /api proxy because the secret is never logged.
   */
  if (cron) {
    modules["__mattrax_cron.js"] = {
      type: "esm",
      contents: `import * as worker from "./index.js";
const scheduled = worker.default.scheduled;
export default {
  fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/api/__mattrax/cron") {
      const secret = env.MATTRAX_CRON_SECRET;
      if (typeof secret !== "string" || request.headers.get("x-mattrax-cron-secret") !== secret)
        return new Response("Not Found", { status: 404 });
      return Promise.resolve(
        scheduled({ cron: url.searchParams.get("cron") ?? "", scheduledTime: Date.now() }, env, ctx),
      ).then(
        () => new Response("ok"),
        (cause) => new Response(String(cause), { status: 500 }),
      );
    }
    return worker.default.fetch(request, env, ctx);
  },
  ...(scheduled ? { scheduled } : {}),
};
`,
    };
  }

  return {
    ...config,
    manifest: {
      mainModule: cron ? "__mattrax_cron.js" : config.manifest.mainModule,
      modules,
    },
  };
};

/**
 * Local bindings. Secrets become plain text bindings because a self-hosted
 * deployment has no secret store; unset secrets are removed so the Worker sees
 * the same `undefined` it would on Cloudflare before the secret is set.
 */
const localiseEnvironment = (
  config: WorkerConfig,
  overrides: Record<string, Binding | undefined>,
): Record<string, Binding> => {
  const environment: Record<string, Binding> = {};

  for (const [name, spec] of Object.entries(config.env ?? {})) {
    if (spec.type === "secret" || spec.type === "text") {
      const value =
        process.env[name] ??
        (spec.type === "text" && typeof spec.value === "string" ? spec.value : undefined);

      if (value !== undefined && value !== "") environment[name] = { type: "text", value };
      continue;
    }

    environment[name] = spec;
  }

  for (const [name, spec] of Object.entries(overrides)) {
    if (spec === undefined) delete environment[name];
    else environment[name] = spec;
  }

  return environment;
};

const loadWorker = async (
  worker: WorkerDeployment,
  overrides: Record<string, Binding | undefined>,
  options?: { cron?: boolean },
): Promise<WorkerConfig> => {
  const config = await loadManifest(worker.directory, worker.config, options);

  config.env = localiseEnvironment(worker.config, overrides);

  return config;
};

/**
 * Bindings the Worker reads but the deployment config does not declare, because
 * they only exist for whitelabel/self-hosted installs.
 */
const SELF_HOST_BINDINGS = [
  "WINDOWS_ORGANIZATION_ID",
  "WINDOWS_FEDERATED_AUDIENCE",
  "TRUST_DEVICE_IDENTITY_HEADERS",
  // Email provider credentials are declared secrets only when a Cloudflare
  // deploy supplies them, so a container has to add them explicitly.
  "RESEND_API_KEY",
  "POSTMARK_SERVER_TOKEN",
  "MAIL_RELAY_SECRET",
];

const cronSecret = randomBytes(32).toString("base64url");

const extraBindings = (): Record<string, Binding> => {
  const bindings: Record<string, Binding> = {
    MATTRAX_CRON_SECRET: { type: "text", value: cronSecret },
  };

  for (const name of SELF_HOST_BINDINGS) {
    const value = process.env[name];

    if (value !== undefined && value !== "") bindings[name] = { type: "text", value };
  }

  return bindings;
};

/**
 * Outbound email. `MAIL_TRANSPORT` selects a real transport; without one the
 * container declares `MATTRAX_EMAIL_DISABLED` so `/api/ready` reports
 * `mailer: skipped` instead of a misconfiguration. Validation happens here
 * rather than at the first send so a typo fails the boot, not onboarding.
 */
const mailTransport = (process.env.MAIL_TRANSPORT ?? "").trim().toLowerCase();
const mailFrom = (process.env.MAIL_FROM ?? "").trim();

const mailRequired: Record<string, readonly string[]> = {
  resend: ["RESEND_API_KEY"],
  postmark: ["POSTMARK_SERVER_TOKEN"],
  smtp: ["MAIL_RELAY_URL", "MAIL_RELAY_SECRET"],
};

const mailEnabled = Object.hasOwn(mailRequired, mailTransport);

if (mailTransport === "cloudflare")
  fail(
    "MAIL_TRANSPORT=cloudflare needs the Cloudflare send_email binding, which a container does not have; use resend, postmark or smtp",
  );

if (mailTransport && mailTransport !== "disabled" && !mailEnabled)
  fail(`MAIL_TRANSPORT=${mailTransport} is not supported; use resend, postmark, smtp or disabled`);

if (mailEnabled) {
  const missing = mailRequired[mailTransport].filter((name) => !(process.env[name] ?? "").trim());

  if (missing.length > 0)
    fail(`${missing.join(" and ")} required when MAIL_TRANSPORT=${mailTransport}`);

  if (!mailFrom) fail("MAIL_FROM is required when MAIL_TRANSPORT is set");

  if (mailTransport === "smtp" && (process.env.MAIL_RELAY_SECRET ?? "").trim().length < 16)
    fail("MAIL_RELAY_SECRET must be at least 16 characters");
}

const apiOverrides: Record<string, Binding | undefined> = {
  ...extraBindings(),
  [hyperdriveBinding[0]]: {
    type: "hyperdrive",
    id: hyperdriveBinding[1].id ?? "mattrax-selfhost",
    dev: { connectionString: databaseUrl },
  },
  [storageBinding[0]]: {
    type: "r2",
    name: process.env.R2_BUCKET ?? storageBinding[1].name ?? "mattrax",
  },
};

// The `send_email` binding only exists on Cloudflare. Removing it leaves the
// Worker with the transport selected by `MAIL_TRANSPORT`; with none, the
// application has no mailer at all and says so instead of writing codes to the
// log. The explicit disabled flag makes readiness `degraded`, not unhealthy.
if (emailBinding) {
  apiOverrides[emailBinding[0]] = undefined;

  if (!mailEnabled) apiOverrides.MATTRAX_EMAIL_DISABLED = { type: "text", value: "true" };
}

const apiConfig = await loadWorker(api, apiOverrides, { cron: true });

const webConfig = await loadWorker(web, {});

const assetsDirectory = path.join(web.directory, "assets");

if (existsSync(assetsDirectory))
  webConfig.assets = {
    // The build config may already carry asset options (run-worker-first,
    // HTML handling, a base path). Merge rather than replace them, and keep
    // the directory pointed at the copied build output so Miniflare also
    // reads `_headers` and `_redirects` from it.
    ...webConfig.assets,
    directory: assetsDirectory,
    hasUserWorker: true,
    notFoundHandling: "none",
  } satisfies AssetsOptions;

/**
 * Apply Drizzle migrations before serving traffic. Self-hosted deployments are
 * usually a single container pointed at an empty database, so doing this here
 * removes a separate one-shot job from the install instructions.
 */
if (process.env.SKIP_MIGRATIONS !== "1") {
  const migrationsDirectory = path.resolve(
    process.env.MATTRAX_MIGRATIONS_DIR ?? path.join(here, "..", "migrations"),
  );

  if (existsSync(migrationsDirectory))
    await migrate({ databaseUrl, migrationsDirectory, log: console.log });
  else console.warn(`mattrax self-host: no migrations found at ${migrationsDirectory}`);
}

if (emailBinding && !mailEnabled)
  console.warn(
    "mattrax self-host: outbound email is disabled; set MAIL_TRANSPORT (resend, postmark or smtp) and MAIL_FROM to send sign-in codes and invitations (/api/ready reports mailer: skipped)",
  );

const requestedLogLevel = (process.env.LOG_LEVEL ?? "").toUpperCase();

const logLevel = Object.hasOwn(LogLevel, requestedLogLevel)
  ? (LogLevel[requestedLogLevel as keyof typeof LogLevel] ?? LogLevel.INFO)
  : LogLevel.INFO;

const miniflareOptions: MiniflareOptions = {
  // The first Worker receives requests from the public listener; the web
  // Worker proxies /api, /mdm and /scim to the API Worker over a service
  // binding, matching the Cloudflare deployment topology.
  //
  // `worker.config.json` is validated structurally above, but is narrower than
  // Miniflare's full schema (triggers and bindings are forwarded as written by
  // `cf build`), so the workers are narrowed at this library boundary.
  workers: [{ config: webConfig }, { config: apiConfig }] as MiniflareOptions["workers"],
  host,
  port,
  resourcePersistencePath: dataDirectory,
  log: new Log(logLevel),
};

const miniflare = new Miniflare(miniflareOptions);

await miniflare.ready;

/**
 * Recreate the platform's cron scheduler: workerd registers the triggers but
 * has no clock, so the host process fires them through the internal route the
 * API entry module exposes.
 */
const isScheduledTrigger = (
  trigger: WorkerTrigger,
): trigger is WorkerTrigger & { schedule: string } =>
  trigger.type === "scheduled" && typeof trigger.schedule === "string";

const cronExpressions = (api.config.triggers ?? [])
  .filter(isScheduledTrigger)
  .map((trigger) => trigger.schedule);

const CRON_LOOPBACK_HOSTS = new Map([
  ["0.0.0.0", "127.0.0.1"],
  ["::", "[::1]"],
]);

const stopCron = startCronScheduler({
  expressions: cronExpressions,
  trigger: async (expression) => {
    const loopback = CRON_LOOPBACK_HOSTS.get(host) ?? host;
    const url = new URL(`http://${loopback}:${port}/api/__mattrax/cron`);

    url.searchParams.set("cron", expression);

    const response = await fetch(url, {
      method: "POST",
      headers: { "x-mattrax-cron-secret": cronSecret },
    });

    if (!response.ok) throw new Error(await response.text());
  },
});

console.log(`mattrax self-host: listening on http://${host}:${port}`);

console.log(`mattrax self-host: origin ${origin}`);

console.log(`mattrax self-host: data directory ${dataDirectory}`);

if (cronExpressions.length > 0)
  console.log(`mattrax self-host: cron triggers ${cronExpressions.join(", ")}`);

const shutdown = async (signal: string): Promise<void> => {
  console.log(`mattrax self-host: received ${signal}, shutting down`);

  stopCron();
  await miniflare.dispose();
  process.exit(0);
};

process.on("SIGINT", () => void shutdown("SIGINT"));

process.on("SIGTERM", () => void shutdown("SIGTERM"));
