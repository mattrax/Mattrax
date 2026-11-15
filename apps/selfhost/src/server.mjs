#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Log, LogLevel, Miniflare } from "miniflare";
import { findBinding, readWorkerConfig } from "./config.mjs";
import { startCronScheduler } from "./cron.mjs";
import { migrate } from "./migrate.mjs";

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

const origin = process.env.ORIGIN;
const authSecret = process.env.AUTH_SECRET;
const databaseUrl = process.env.DATABASE_URL;

const fail = (message) => {
  console.error(`mattrax self-host: ${message}`);

  process.exit(1);
};

for (const [name, value] of [
  ["ORIGIN", origin],
  ["AUTH_SECRET", authSecret],
  ["DATABASE_URL", databaseUrl],
]) {
  if (!value) fail(`${name} is required`);
}

const requireHttpsOrigin = () => {
  let url;

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
const loadManifest = async (directory, config, { cron = false } = {}) => {
  const bundle = path.join(directory, "bundle");
  const modules = {};

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
const localiseEnvironment = (config, overrides) => {
  const environment = {};

  for (const [name, spec] of Object.entries(config.env ?? {})) {
    if (spec.type === "secret" || spec.type === "text") {
      const value = process.env[name] ?? (spec.type === "text" ? spec.value : undefined);

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

const loadWorker = async (worker, overrides, options) => {
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
];

const cronSecret = randomBytes(32).toString("base64url");

const extraBindings = () => {
  const bindings = { MATTRAX_CRON_SECRET: { type: "text", value: cronSecret } };

  for (const name of SELF_HOST_BINDINGS) {
    const value = process.env[name];

    if (value !== undefined && value !== "") bindings[name] = { type: "text", value };
  }

  return bindings;
};

const apiOverrides = {
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

// Email delivery needs a provider binding that a container cannot synthesise.
// Removing it makes the application log messages instead of failing requests.
if (emailBinding) apiOverrides[emailBinding[0]] = undefined;

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
  };

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

if (emailBinding)
  console.warn(
    "mattrax self-host: outbound email is disabled; sign-in codes and password-reset links are written to the log",
  );

const miniflare = new Miniflare({
  // The first Worker receives requests from the public listener; the web
  // Worker proxies /api, /mdm and /scim to the API Worker over a service
  // binding, matching the Cloudflare deployment topology.
  workers: [
    { config: webConfig },
    { config: apiConfig },
  ],
  host,
  port,
  resourcePersistencePath: dataDirectory,
  log: new Log(LogLevel[process.env.LOG_LEVEL?.toUpperCase()] ?? LogLevel.INFO),
});

await miniflare.ready;

/**
 * Recreate the platform's cron scheduler: workerd registers the triggers but
 * has no clock, so the host process fires them through the internal route the
 * API entry module exposes.
 */
const cronExpressions = (api.config.triggers ?? [])
  .filter((trigger) => trigger.type === "scheduled")
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

const shutdown = async (signal) => {
  console.log(`mattrax self-host: received ${signal}, shutting down`);

  stopCron();
  await miniflare.dispose();
  process.exit(0);
};

process.on("SIGINT", () => void shutdown("SIGINT"));

process.on("SIGTERM", () => void shutdown("SIGTERM"));
