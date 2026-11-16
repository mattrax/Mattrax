import "reflect-metadata";
import "./nodeEnvironment.js";
import path from "node:path";
import { createApiRuntime } from "./app.js";
import { nodeCryptoLayer } from "./cryptoNode.js";
import { fileSystemR2 } from "./r2Node.js";

/**
 * Node entry point for the API.
 *
 * The Cloudflare entry takes its configuration from bindings. Here the same
 * shape is assembled from the process environment: Hyperdrive becomes a MySQL
 * connection, the R2 binding becomes a directory, and every plain binding is
 * read from `process.env`. The runtime itself is the shared `app.ts`, so the
 * routes and scheduled work are identical on both hosts.
 */

const runtime = createApiRuntime(nodeCryptoLayer, { cacheHandler: true });

const requireEnv = (name: string): string => {
  const value = process.env[name]?.trim();

  if (!value) throw new Error(`${name} is required`);

  return value;
};

/**
 * TLS options from the connection URL. Managed MySQL providers use
 * `ssl-mode=REQUIRED`; `VERIFY_CA`/`VERIFY_IDENTITY` also verify the chain.
 */
const sslOptions = (parameters: URLSearchParams) => {
  const mode = (parameters.get("ssl-mode") ?? parameters.get("sslmode") ?? "").toUpperCase();
  const ssl = parameters.get("ssl")?.toLowerCase();

  if (mode === "DISABLED" || ssl === "false") return undefined;

  if (mode === "REQUIRED" || ssl === "true") return { rejectUnauthorized: false };

  if (mode === "VERIFY_CA" || mode === "VERIFY_IDENTITY") return { rejectUnauthorized: true };

  return undefined;
};

const parseDatabase = () => {
  const url = process.env.DATABASE_URL?.trim();

  if (url) {
    const parsed = new URL(url);
    const database = parsed.pathname.replace(/^\//, "");

    if (!parsed.hostname || !database)
      throw new Error("DATABASE_URL must include a host and database");

    const ssl = sslOptions(parsed.searchParams);

    return {
      host: parsed.hostname,
      port: Number(parsed.port || 3306),
      user: decodeURIComponent(parsed.username),
      password: decodeURIComponent(parsed.password),
      database,
      ...(ssl ? { ssl } : {}),
    };
  }

  return {
    host: requireEnv("DATABASE_HOST"),
    port: Number(process.env.DATABASE_PORT ?? 3306),
    user: requireEnv("DATABASE_USER"),
    password: requireEnv("DATABASE_PASSWORD"),
    database: requireEnv("DATABASE_NAME"),
  };
};

const dataDirectory = process.env.DATA_DIR?.trim() || "/data";

const env = {
  ...process.env,
  ORIGIN: requireEnv("ORIGIN"),
  AUTH_SECRET: requireEnv("AUTH_SECRET"),
  TRUSTED_ORIGINS: process.env.TRUSTED_ORIGINS,
  HYPERDRIVE: parseDatabase(),
  STORAGE: fileSystemR2({ root: path.join(dataDirectory, "storage") }),
  CF_VERSION_METADATA: { id: process.env.CF_VERSION_METADATA_ID ?? "selfhost" },
} as unknown as Env;

/** The subset of Workers' `ExecutionContext` the runtime uses. */
export type RuntimeContext = {
  waitUntil: (promise: Promise<unknown>) => void;
  passThroughOnException?: () => void;
};

export const fetch = (request: Request, context: RuntimeContext): Promise<Response> =>
  runtime.fetch(request, env, context as ExecutionContext);

export const scheduled = (
  controller: ScheduledController,
  context: RuntimeContext,
): Promise<void> => runtime.scheduled(controller, env, context as ExecutionContext);

export default { fetch, scheduled };
